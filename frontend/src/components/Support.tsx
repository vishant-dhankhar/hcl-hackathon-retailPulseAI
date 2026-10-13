import { useEffect, useState, type FormEvent } from 'react';
import { api, type Order, type Ticket, type User } from '../api';

export function Support({
  storeId,
  role,
  run,
}: {
  storeId: string;
  role: User['role'];
  run: (task: () => Promise<void>) => Promise<void>;
}) {
  const customer = role === 'CUSTOMER';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState('');
  const [status, setStatus] = useState(customer ? 'ALL' : 'ACTIVE');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  async function load() {
    setTickets(await api<Ticket[]>(`/support/tickets?status=${status}`));
  }
  useEffect(() => {
    let current = true;
    setLoading(true);
    void run(async () => {
      try {
        const [requests, purchases] = await Promise.all([
          api<Ticket[]>(`/support/tickets?status=${status}`),
          customer ? api<Order[]>('/orders') : Promise.resolve([]),
        ]);
        if (current) {
          setTickets(requests);
          setOrders(purchases);
        }
      } finally {
        if (current) setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [status, customer]);
  function act(task: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    void run(async () => {
      try {
        await task();
        await load();
      } finally {
        setPending(false);
      }
    });
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    act(async () => {
      await api('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: data.get('subject'),
          description: data.get('description'),
          ...(orderId ? { orderId } : { locationId: storeId }),
        }),
      });
      form.reset();
      setOrderId('');
    });
  }
  return (
    <div className="stack">
      {customer && (
        <form className="stack" onSubmit={create}>
          <label>
            Related order
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={pending}>
              <option value="">General question about selected store</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} · {o.location.name} · {o.status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <small>
            {orderId
              ? 'This ticket is routed to the location fulfilling your order. You can see staff answers below.'
              : 'General questions go to the store currently selected in the catalogue.'}
          </small>
          <label>
            Subject
            <input name="subject" required minLength={3} maxLength={120} disabled={pending} />
          </label>
          <label>
            How can we help?
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={3000}
              disabled={pending}
            />
          </label>
          <button className="button dark" disabled={pending || loading}>
            {pending ? 'Saving…' : 'Create support ticket'}
          </button>
          <small>
            Priority follows your membership tier. All staff answers are visible to you.
          </small>
        </form>
      )}
      <label>
        Ticket status
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={pending}>
          <option value="ALL">All tickets</option>
          <option value="ACTIVE">Open and escalated</option>
          <option value="OPEN">Open</option>
          <option value="ESCALATED">Escalated</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </label>
      <button
        className="text-button"
        disabled={pending || loading}
        onClick={() => act(async () => {})}
      >
        Refresh tickets
      </button>
      {loading ? (
        <p role="status">Loading tickets…</p>
      ) : !tickets.length ? (
        <p>No tickets match this status.</p>
      ) : (
        tickets.map((ticket) => (
          <div className="record stack" key={ticket.id}>
            <strong>{ticket.subject}</strong>
            <small>
              {ticket.status} · {ticket.priority} priority ·{' '}
              {new Date(ticket.createdAt).toLocaleString()}
            </small>
            {!customer && <small>Customer: {ticket.user.name}</small>}
            <small>
              {ticket.order ? `Order ${ticket.order.number} · ` : 'General question · '}
              {ticket.location
                ? `${ticket.location.name}, ${ticket.location.city}`
                : 'Admin support'}
            </small>
            <p className="support-message">{ticket.description}</p>
            <div className="stack" aria-label="Staff answers">
              {ticket.replies.length ? (
                ticket.replies.map((reply) => (
                  <blockquote className="support-answer" key={reply.id}>
                    <strong>
                      {reply.author.name} ·{' '}
                      {reply.authorRole === 'ADMIN' ? 'Admin' : 'Store manager'}
                    </strong>
                    <p className="support-message">{reply.body}</p>
                    <small>{new Date(reply.createdAt).toLocaleString()}</small>
                  </blockquote>
                ))
              ) : (
                <small>No staff answer yet.</small>
              )}
            </div>
            {!customer && ticket.status !== 'RESOLVED' && (
              <>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const data = new FormData(form);
                    act(async () => {
                      await api(`/support/tickets/${ticket.id}/replies`, {
                        method: 'POST',
                        body: JSON.stringify({ body: data.get('body') }),
                      });
                      form.reset();
                    });
                  }}
                >
                  <label>
                    Answer to customer
                    <textarea
                      name="body"
                      required
                      minLength={3}
                      maxLength={3000}
                      disabled={pending}
                    />
                  </label>
                  <button className="button dark" disabled={pending}>
                    Send answer
                  </button>
                </form>
                <div className="inline-actions">
                  {role === 'STORE_MANAGER' && ticket.status === 'OPEN' && (
                    <button
                      disabled={pending}
                      onClick={() =>
                        act(async () => {
                          await api(`/support/tickets/${ticket.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'ESCALATED' }),
                          });
                        })
                      }
                    >
                      Escalate to admin
                    </button>
                  )}
                  <button
                    disabled={pending || !ticket.replies.length}
                    onClick={() =>
                      act(async () => {
                        await api(`/support/tickets/${ticket.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'RESOLVED' }),
                        });
                      })
                    }
                  >
                    Resolve ticket
                  </button>
                </div>
                {!ticket.replies.length && (
                  <small>Send an answer before marking this ticket resolved.</small>
                )}
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}
