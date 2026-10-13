import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from 'react';
import { MessageCircle, Send, RotateCcw, X } from 'lucide-react';
import { api, money, type Answer, type ChatAction, type ChatPanel } from '../api';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  answer?: Answer;
};

// One review control handles every server-approved mutation. Model text never executes writes.
export function ActionReview({
  action,
  done,
  close,
}: {
  action: ChatAction;
  done: (result: {
    message: string;
    navigation?: Answer['navigation'];
    storeId?: string;
    records?: Answer['records'];
  }) => void;
  close: () => void;
}) {
  const [body, setBody] = useState(action.body || '');
  const [quantity, setQuantity] = useState(action.quantity ?? 1);
  const [reason, setReason] = useState(action.reason || '');
  const [approval, setApproval] = useState<{ token: string; summary: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      if (!approval) {
        const prepared = await api<{
          token?: string;
          summary?: string;
          existingRequest?: boolean;
          message?: string;
          records?: Answer['records'];
        }>('/assistant/chat/actions/prepare', {
          method: 'POST',
          body: JSON.stringify({
            kind: action.kind,
            targetId: action.targetId,
            ...(action.kind === 'TICKET_REPLY' ? { body } : {}),
            ...(['RESTOCK', 'SET_STOCK'].includes(action.kind) ? { quantity, reason } : {}),
            ...(action.kind === 'ADD_CART' ? { quantity, storeId: action.storeId } : {}),
          }),
        });
        // A pending request replaces the duplicate form with its real, reviewable workflow actions.
        if (prepared.existingRequest)
          done({
            message: prepared.message || 'An existing request was found.',
            records: prepared.records,
          });
        else if (prepared.token && prepared.summary)
          setApproval({ token: prepared.token, summary: prepared.summary });
        else throw new Error('Could not prepare the action. Please try again.');
      } else {
        const result = await api<{
          message: string;
          navigation?: Answer['navigation'];
          storeId?: string;
          records?: Answer['records'];
        }>('/assistant/chat/actions/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: approval.token }),
        });
        done(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed. Please retry.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="chat-review stack"
      aria-label="Review approved action"
      onSubmit={(e) => void submit(e)}
    >
      <strong>{action.label}</strong>
      {!approval && action.kind === 'TICKET_REPLY' && (
        <label>
          Customer reply
          <textarea
            required
            minLength={3}
            maxLength={3000}
            rows={3}
            value={body}
            disabled={pending}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      )}
      {!approval && ['RESTOCK', 'SET_STOCK'].includes(action.kind) && (
        <>
          <label>
            {action.kind === 'SET_STOCK' ? 'New available stock quantity' : 'Units to replenish'}
            <input
              type="number"
              required
              min={action.kind === 'SET_STOCK' ? 0 : 1}
              max={action.kind === 'SET_STOCK' ? 1000000 : 1000}
              step={1}
              value={quantity}
              disabled={pending}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            Reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}
      {!approval && action.kind === 'ADD_CART' && (
        <label>
          Cart quantity
          <input
            type="number"
            required
            min={1}
            max={99}
            step={1}
            value={quantity}
            disabled={pending}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
      )}
      {approval && <p>{approval.summary}</p>}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <button type="submit" className="button dark" disabled={pending}>
          {pending ? 'Please wait…' : approval ? 'Confirm action' : 'Review action'}
        </button>
        {approval && (
          <button type="button" disabled={pending} onClick={() => setApproval(null)}>
            Edit
          </button>
        )}
        <button type="button" disabled={pending} onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Chatbot({
  messages,
  setMessages,
  storeId,
  customer,
  openAction,
  openProduct,
  managedLocations,
}: {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  storeId: string;
  customer: boolean;
  managedLocations?: string;
  openAction: (panel: ChatPanel, storeId?: string) => void;
  openProduct: (id: string, storeId?: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [excerpt, setExcerpt] = useState<{ title: string; content: string } | null>(null);
  const [review, setReview] = useState<ChatAction | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      sourceRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, pending]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || pending || review) return;
    setPending(true);
    setError('');
    setExcerpt(null);
    setQuestion('');
    const controller = new AbortController();
    request.current = controller;
    const history = messages.slice(-8).map(({ role, content, answer }) => ({
      role,
      // IDs and names support natural follow-ups; the server checks access to every referenced record.
      content:
        `${content}${answer?.records?.length ? '\nRecords: ' + answer.records.map((r) => `${r.id}: ${r.title}`).join('; ') : ''}${answer?.products?.length ? '\nProducts: ' + answer.products.map((p) => `${p.productId}: ${p.product.name}`).join('; ') : ''}`.slice(
          0,
          4000,
        ),
    }));
    const id = crypto.randomUUID();
    setMessages((previous) => [...previous, { id, role: 'user', content: text }]);
    try {
      const answer = await api<Answer>('/assistant/chat', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ question: text, history, storeId }),
      });
      if (!controller.signal.aborted)
        setMessages((previous) => [
          ...previous,
          { id: crypto.randomUUID(), role: 'assistant', content: answer.answer, answer },
        ]);
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessages((previous) => previous.filter((m) => m.id !== id));
        setQuestion(text);
        setError(e instanceof Error ? e.message : 'Could not send. Please retry.');
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  async function showSource(source: Answer['sources'][number]) {
    sourceRequest.current?.abort();
    const controller = new AbortController();
    sourceRequest.current = controller;
    try {
      setError('');
      const result = await api<{ content: string }>(`/knowledge/sources/${source.chunkId}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        setExcerpt({
          title: `${source.document} · ${source.section} · ${source.version}`,
          content: result.content,
        });
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Source unavailable.');
    }
  }
  return (
    <div className="stack chatbot">
      {managedLocations && <small>Managing: {managedLocations}</small>}
      <div className="chat-toolbar">
        <small>Search, ask and review actions in one conversation</small>
        <button
          className="text-button"
          disabled={pending || !!review || !messages.length}
          onClick={() => {
            setMessages([]);
            setExcerpt(null);
            setError('');
          }}
        >
          <RotateCcw size={14} /> New chat
        </button>
      </div>
      <div
        className="chat-transcript"
        role="log"
        aria-label="RetailPulse conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!messages.length && (
          <div className="chat-welcome">
            <MessageCircle size={28} />
            <h3>How can I help?</h3>
            <p>
              {customer
                ? 'Find the right products, ask about policies, track orders or review checkout and cancellations.'
                : 'Find products, check orders and inventory, or handle tickets and replenishment with reviewed actions.'}
            </p>
            {(customer
              ? [
                  'Find me a laptop with 32 GB RAM',
                  'What are my delivery charges?',
                  'Show my orders',
                  'Show my support tickets',
                ]
              : [
                  'Find me a laptop with 32 GB RAM',
                  'Show low stock items',
                  'How many total orders are there?',
                  'Show open tickets',
                  'Show replenishment requests',
                ]
            ).map((text) => (
              <button key={text} onClick={() => setQuestion(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`chat-message ${message.role}`}
            aria-label={message.role === 'user' ? 'You' : 'RetailPulse chatbot'}
          >
            <small>{message.role === 'user' ? 'You' : 'RetailPulse'}</small>
            <p>{message.content}</p>
            {message.answer?.products?.map((p) => (
              <div className="chat-record" key={p.productId}>
                <strong>
                  {p.product.name} · {money(p.product.price)}
                </strong>
                <p>{p.reason}</p>
                <small>In stock at the requested store</small>
                <div className="inline-actions">
                  {p.actions?.map((a) => (
                    <button
                      key={a.kind}
                      disabled={pending || !!review}
                      onClick={() => setReview(a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <button
                  disabled={pending || !!review}
                  onClick={() => openProduct(p.productId, message.answer?.storeId)}
                >
                  {customer ? 'View product & review purchase' : 'View product'}
                </button>
              </div>
            ))}
            {message.answer?.records?.map((r) => (
              <div className="chat-record" key={r.id}>
                <strong>{r.title}</strong>
                <small>ID: {r.id}</small>
                <p>{r.detail}</p>
                <div className="inline-actions">
                  {r.actions.map((a) => (
                    <button
                      key={a.kind}
                      disabled={
                        pending ||
                        !!review ||
                        (a.kind !== 'SET_STOCK' && completed.includes(`${a.kind}:${a.targetId}`))
                      }
                      onClick={() => setReview(a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {message.answer?.navigation?.map((a) => (
              <button
                key={a.panel}
                disabled={pending || !!review}
                onClick={() => openAction(a.panel, message.answer?.storeId)}
              >
                {a.label}
              </button>
            ))}
            {!!message.answer?.sources.length && (
              <div className="chat-sources" aria-label="Policy sources">
                {message.answer.sources.map((s) => (
                  <button key={s.chunkId} onClick={() => void showSource(s)}>
                    {s.document} · {s.section} · {s.version}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        {pending && (
          <p role="status" className="chat-thinking">
            Checking your request…
          </p>
        )}
        <div ref={end} />
      </div>
      {review && (
        <ActionReview
          key={`${review.kind}:${review.targetId}`}
          action={review}
          close={() => setReview(null)}
          done={(result) => {
            setCompleted((previous) => [...previous, `${review.kind}:${review.targetId}`]);
            setReview(null);
            setMessages((previous) => [
              // Keep earlier messages as history; only the refreshed card offers current actions.
              ...previous.map((message) =>
                message.answer?.records && result.records?.length
                  ? {
                      ...message,
                      answer: {
                        ...message.answer,
                        records: message.answer.records.map((record) =>
                          result.records!.some((current) => current.id === record.id)
                            ? { ...record, actions: [] }
                            : record,
                        ),
                      },
                    }
                  : message,
              ),
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: result.message,
                answer: {
                  answer: result.message,
                  mode: 'ACTION',
                  confidence: 'VERIFIED',
                  sources: [],
                  followUpRequired: false,
                  navigation: result.navigation,
                  records: result.records,
                  storeId: result.storeId,
                },
              },
            ]);
          }}
        />
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {excerpt && (
        <aside className="chat-excerpt">
          <button
            className="icon-button"
            aria-label="Close policy source"
            onClick={() => setExcerpt(null)}
          >
            <X size={16} />
          </button>
          <strong>{excerpt.title}</strong>
          <p>{excerpt.content}</p>
        </aside>
      )}
      <form className="chat-composer" onSubmit={(e) => void send(e)}>
        <label>
          Message
          <textarea
            required
            maxLength={1000}
            rows={2}
            disabled={pending || !!review}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question or answer a follow-up…"
          />
        </label>
        <button
          className="button dark"
          disabled={pending || !!review || !question.trim()}
          type="submit"
        >
          <Send size={16} /> Send message
        </button>
      </form>
      <small>
        Live results respect your account permissions. Changes require review and confirmation.
      </small>
    </div>
  );
}
