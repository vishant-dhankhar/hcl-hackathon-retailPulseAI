import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Sparkles, ShoppingBag, Minus, Plus, Check, ArrowUpRight } from 'lucide-react';
import {
  api,
  money,
  type User,
  type CartLine,
  type Quote,
  type Order,
  type Ticket,
  type Inventory,
  type Proposal,
  type Knowledge,
  type Answer,
  type Recommendations,
  type Store,
} from '../api';
import { ProductArt } from '../ProductArt';
import { ActionReview } from './Chatbot';
export function Login({
  submit,
  busy,
}: {
  submit: (data: { email: string; password: string; name?: string }) => void;
  busy: boolean;
}) {
  const [register, setRegister] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') || '').trim();
    const password = String(f.get('password') || '');
    const name = String(f.get('name') || '').trim();
    const invalid: Record<string, string> = {};
    if (register && name.length < 2)
      invalid.name = name
        ? 'Enter at least 2 characters for your name.'
        : 'Please enter your full name.';
    if (!email) invalid.email = 'Please enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      invalid.email = 'Enter a valid email address, such as name@example.com.';
    if (!password.trim()) invalid.password = 'Please enter your password.';
    else if (password.length < 12)
      invalid.password = 'Your password must contain at least 12 characters.';
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      (e.currentTarget.elements.namedItem(Object.keys(invalid)[0]) as HTMLInputElement)?.focus();
      return;
    }
    submit({
      email,
      password,
      ...(register ? { name } : {}),
    });
  }
  return (
    <form
      onSubmit={handle}
      noValidate
      className="stack"
      onChange={(e) => {
        const field = e.target instanceof HTMLInputElement ? e.target.name : '';
        setErrors((previous) => ({ ...previous, [field]: '' }));
      }}
    >
      <p>
        {register
          ? 'Create your customer account to save your favourites and shop.'
          : 'Sign in to shop, ask questions, and track your orders.'}
      </p>
      {register && (
        <label>
          Full name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            disabled={busy}
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'login-name-error' : undefined}
          />
          {errors.name && (
            <small id="login-name-error" role="alert" className="chat-error">
              {errors.name}
            </small>
          )}
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          required
          disabled={busy}
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
        />
        {errors.email && (
          <small id="login-email-error" role="alert" className="chat-error">
            {errors.email}
          </small>
        )}
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          disabled={busy}
          autoComplete={register ? 'new-password' : 'current-password'}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'login-password-error' : undefined}
        />
        {errors.password && (
          <small id="login-password-error" role="alert" className="chat-error">
            {errors.password}
          </small>
        )}
      </label>
      <small>
        Use at least 12 characters. Demo account credentials are configured in the backend
        environment.
      </small>
      <button className="button dark" disabled={busy}>
        {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
        <ArrowRight size={17} />
      </button>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => {
          setRegister(!register);
          setErrors({});
        }}
      >
        {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </form>
  );
}
export function Cart({
  cart,
  busy,
  storeId,
  checkoutKey,
  quantity,
  submit,
  done,
}: {
  cart: CartLine[];
  busy: boolean;
  storeId: string;
  checkoutKey: string;
  quantity: (id: string, n: number) => void;
  submit: (task: () => Promise<void>) => void;
  done: () => void;
}) {
  const [fulfillment, setFulfillment] = useState('PICKUP');
  const [express, setExpress] = useState(false);
  const [address, setAddress] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  useEffect(() => setQuote(null), [cart, fulfillment, express, address, storeId]);
  const input = {
    storeId,
    fulfillment,
    express,
    address: fulfillment === 'DELIVERY' ? address : undefined,
  };
  if (!cart.length)
    return (
      <div className="empty-state">
        <ShoppingBag />
        <h3>A little room for something good</h3>
        <p>Explore the collection and add a product to your bag.</p>
      </div>
    );
  return (
    <div className="stack">
      {cart.map((c) => (
        <div className="cart-line" key={c.productId}>
          <ProductArt name={c.product.name} color={c.product.color} small />
          <div>
            <strong>{c.product.name}</strong>
            <p>{money(c.product.price)}</p>
          </div>
          <div className="stepper">
            <button
              disabled={busy}
              aria-label={`Remove one ${c.product.name}`}
              onClick={() => quantity(c.productId, c.quantity - 1)}
            >
              <Minus size={14} />
            </button>
            <span>{c.quantity}</span>
            <button
              disabled={busy}
              aria-label={`Add one ${c.product.name}`}
              onClick={() => quantity(c.productId, c.quantity + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      ))}
      <label>
        How would you like your order?
        <select
          value={fulfillment}
          disabled={busy}
          onChange={(e) => setFulfillment(e.target.value)}
        >
          <option value="PICKUP">Store pickup</option>
          <option value="DELIVERY">Home delivery</option>
        </select>
      </label>
      {fulfillment === 'DELIVERY' && (
        <>
          <label>
            Delivery address
            <textarea
              value={address}
              disabled={busy}
              minLength={10}
              maxLength={500}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={express}
              disabled={busy}
              onChange={(e) => setExpress(e.target.checked)}
            />{' '}
            Express delivery
          </label>
        </>
      )}
      <small>
        Final stock and membership benefits are checked by the server. Payments are simulated for
        this demo.
      </small>
      {quote ? (
        <>
          <div className="quote">
            <p>
              Subtotal <strong>{money(quote.subtotal)}</strong>
            </p>
            <p>
              Delivery <strong>{money(quote.deliveryCharge)}</strong>
            </p>
            <p className="total">
              Total <strong>{money(quote.total)}</strong>
            </p>
            <small>Fulfilled by {quote.locationName}</small>
          </div>
          <button
            className="button dark"
            disabled={busy}
            onClick={() =>
              submit(async () => {
                await api('/checkout', {
                  method: 'POST',
                  headers: { 'idempotency-key': checkoutKey },
                  body: JSON.stringify({ ...input, quoteHash: quote.quoteHash }),
                });
                done();
              })
            }
          >
            Place demo order <ArrowRight size={17} />
          </button>
        </>
      ) : (
        <button
          className="button dark"
          disabled={busy}
          onClick={() =>
            submit(async () =>
              setQuote(
                await api<Quote>('/checkout/quote', {
                  method: 'POST',
                  body: JSON.stringify(input),
                }),
              ),
            )
          }
        >
          Review order <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}
export function Assistant({
  productsOnly = false,
  storeId,
  category,
  customer,
  run,
  busy,
}: {
  productsOnly?: boolean;
  storeId: string;
  category: string;
  customer: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState(productsOnly ? 'products' : 'policy');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [source, setSource] = useState('');
  const [budget, setBudget] = useState('');
  return (
    <div className="stack">
      <p>
        {productsOnly
          ? 'Describe the product you’re looking for and your budget.'
          : 'Ask about an approved policy, or describe the product you’re looking for.'}
      </p>
      {!productsOnly && (
        <label>
          Help me with
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setAnswer(null);
              setRecommendations(null);
              setSource('');
            }}
          >
            <option value="policy">Policies and membership benefits</option>
            {customer && <option value="products">Product recommendations</option>}
          </select>
        </label>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          // A source excerpt belongs to one answer and must not survive the next question.
          setSource('');
          setAnswer(null);
          setRecommendations(null);
          void run(async () => {
            if (kind === 'policy')
              setAnswer(
                await api<Answer>('/assistant/ask', {
                  method: 'POST',
                  body: JSON.stringify({ question, category: category || undefined }),
                }),
              );
            else
              setRecommendations(
                await api<Recommendations>('/assistant/recommend', {
                  method: 'POST',
                  body: JSON.stringify({
                    question,
                    storeId,
                    ...(budget ? { maxPrice: Number(budget) } : {}),
                  }),
                }),
              );
          });
        }}
      >
        {kind === 'products' && (
          <label>
            Maximum budget in INR
            <input
              type="number"
              min="1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Optional budget limit"
            />
          </label>
        )}
        <label>
          Your question
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              kind === 'policy'
                ? 'Do Gold members receive free express delivery?'
                : 'A laptop for Java development under ₹60,000'
            }
          />
        </label>
        <button className="button dark" disabled={busy}>
          {busy ? 'Looking into it…' : 'Ask RetailPulse'}
          <Sparkles size={17} />
        </button>
      </form>
      {answer && (
        <div className="answer">
          <small>
            {answer.mode.replaceAll('_', ' ')} · {answer.confidence}
          </small>
          <p>{answer.answer}</p>
          {answer.followUpRequired && <p>Please provide more detail or contact support.</p>}
          <h4>Sources</h4>
          {answer.sources.map((s) => (
            <button
              className="source-button"
              key={s.chunkId}
              onClick={() =>
                void run(async () => {
                  const c = await api<{ content: string }>(`/knowledge/sources/${s.chunkId}`);
                  setSource(c.content);
                })
              }
            >
              {s.document} · {s.section} · {s.version}
              <ArrowUpRight size={14} />
            </button>
          ))}
          {source && <blockquote>{source}</blockquote>}
        </div>
      )}
      {recommendations && (
        <div className="answer">
          <h3>{recommendations.interpretedRequirement}</h3>
          {recommendations.recommendations.map((r) => (
            <div key={r.productId}>
              <strong>
                {r.product.name} · {money(r.product.price)}
              </strong>
              <p>{r.reason}</p>
            </div>
          ))}
          {recommendations.clarifyingQuestion && <p>{recommendations.clarifyingQuestion}</p>}
        </div>
      )}
      <small>
        Generated recommendations require a configured AI provider. Without provider keys, policy
        answers show matching source excerpts.
      </small>
    </div>
  );
}
export function Preferences({
  user,
  categories,
  stores,
  busy,
  save,
}: {
  user: User;
  categories: string[];
  stores: Store[];
  busy: boolean;
  save: (data: unknown) => void;
}) {
  const [selected, setSelected] = useState(user.preferences?.categories || []);
  const [preferredStore, setPreferredStore] = useState(user.preferences?.storeId || '');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          name: f.get('name'),
          preferences: {
            categories: selected,
            ...(f.get('storeId') ? { storeId: String(f.get('storeId')) } : {}),
            ...(f.get('budget') ? { budget: Number(f.get('budget')) } : {}),
          },
        });
      }}
    >
      <p>
        {user.email} · {user.role.replaceAll('_', ' ')} · {user.tier}
      </p>
      <label>
        Name
        <input name="name" required minLength={2} maxLength={80} defaultValue={user.name} />
      </label>
      <label>
        Preferred budget
        <input name="budget" type="number" min="1" defaultValue={user.preferences?.budget} />
      </label>
      <fieldset>
        <legend>Categories you like</legend>
        {categories.map((c) => (
          <label className="check-label" key={c}>
            <input
              type="checkbox"
              checked={selected.includes(c)}
              onChange={(e) =>
                setSelected(e.target.checked ? [...selected, c] : selected.filter((x) => x !== c))
              }
            />
            {c}
          </label>
        ))}
      </fieldset>
      <label>
        Preferred store
        <select
          name="storeId"
          value={preferredStore}
          onChange={(e) => setPreferredStore(e.target.value)}
        >
          <option value="">Choose on each visit</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}, {s.city}
            </option>
          ))}
        </select>
      </label>
      <button className="button dark" disabled={busy}>
        Save preferences <Check size={17} />
      </button>
      <small>Membership and account permissions are managed by an administrator.</small>
    </form>
  );
}
export function Orders({
  customer,
  run,
  busy,
}: {
  customer: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  async function load() {
    setOrders(await api<Order[]>('/orders'));
    setLoaded(true);
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <div className="stack">
      <label>
        Order status
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All orders</option>
          {[...new Set(orders.map((o) => o.status))].map((status) => (
            <option key={status} value={status}>
              {status.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <button className="text-button" disabled={busy} onClick={() => void run(load)}>
        Refresh orders
      </button>
      {!loaded && <p role="status">Loading orders…</p>}
      {loaded && !orders.length && <p>No orders yet.</p>}
      {orders
        .filter((o) => statusFilter === 'ALL' || o.status === statusFilter)
        .map((o) => (
          <article className="record" key={o.id}>
            <div className="record-heading">
              <strong>{o.number}</strong>
              <span className="pill">{o.status.replaceAll('_', ' ')}</span>
            </div>
            <p>{o.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</p>
            <small>
              {o.location.name} · {o.fulfillment} · {new Date(o.createdAt).toLocaleDateString()} ·{' '}
              {money(o.total)}
            </small>
            <div className="inline-actions">
              {o.status === 'PLACED' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/orders/${o.id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: 'CANCELLED' }),
                      });
                      await load();
                    })
                  }
                >
                  Cancel order
                </button>
              )}
              {!customer &&
                (() => {
                  const next =
                    o.fulfillment === 'PICKUP'
                      ? { PLACED: 'READY_FOR_PICKUP', READY_FOR_PICKUP: 'COLLECTED' }
                      : { PLACED: 'PROCESSING', PROCESSING: 'SHIPPED', SHIPPED: 'DELIVERED' };
                  const status = next[o.status as keyof typeof next];
                  return (
                    status && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/orders/${o.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status }),
                            });
                            await load();
                          })
                        }
                      >
                        Mark {status.replaceAll('_', ' ').toLowerCase()}
                      </button>
                    )
                  );
                })()}
            </div>
          </article>
        ))}
    </div>
  );
}
export function Operations({
  run,
  busy,
}: {
  run: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [restock, setRestock] = useState<Inventory | null>(null);
  const [adjustStock, setAdjustStock] = useState<Inventory | null>(null);
  const [adjustmentMessage, setAdjustmentMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<{ items: Inventory[]; proposals: Proposal[] }>({
    items: [],
    proposals: [],
  });
  async function load() {
    setData(await api('/operations/inventory'));
    setLoaded(true);
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <div className="stack">
      <p>
        Stock is scoped to your assigned locations. Replenishment requires explicit approval and
        receipt. Set stock quantity corrects the exact available count after review and
        confirmation.
      </p>
      <div className="filter-controls">
        <input
          aria-label="Search inventory"
          placeholder="Search inventory"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Inventory location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">All assigned locations</option>
          {[...new Map(data.items.map((i) => [i.location.id, i.location])).values()].map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}, {l.city}
            </option>
          ))}
        </select>
        <label className="check-label">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
        <button className="text-button" disabled={busy} onClick={() => void run(load)}>
          Refresh stock
        </button>
      </div>
      {!loaded && <p role="status">Loading inventory…</p>}
      {adjustmentMessage && <p role="status">{adjustmentMessage}</p>}
      {adjustStock && (
        <ActionReview
          key={adjustStock.id}
          action={{
            kind: 'SET_STOCK',
            targetId: adjustStock.id,
            label: `Set stock quantity · ${adjustStock.product.name} · ${adjustStock.location.name}`,
            quantity: adjustStock.quantity,
          }}
          close={() => setAdjustStock(null)}
          done={(result) => {
            setAdjustmentMessage(result.message);
            setAdjustStock(null);
            void run(load);
          }}
        />
      )}
      {restock && (
        <form
          key={restock.id}
          className="record stack"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void run(async () => {
              await api('/operations/replenishment', {
                method: 'POST',
                body: JSON.stringify({
                  productId: restock.productId,
                  locationId: restock.locationId,
                  quantity: Number(form.get('quantity')),
                  reason: form.get('reason'),
                }),
              });
              setRestock(null);
              await load();
            });
          }}
        >
          <strong>
            Replenish {restock.product.name} · {restock.location.name}
          </strong>
          <small>
            Current stock: {restock.quantity}. Stock increases only after approval and receipt.
            Managers can perform these steps for their assigned locations.
          </small>
          <label>
            Units to replenish
            <input
              name="quantity"
              type="number"
              required
              min="1"
              max="1000"
              step="1"
              defaultValue={Math.max(1, restock.targetStock - restock.quantity)}
              disabled={busy}
            />
          </label>
          <label>
            Restock reason
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              defaultValue={`Replenish stock from ${restock.quantity} towards target ${restock.targetStock}.`}
              disabled={busy}
            />
          </label>
          <div className="inline-actions">
            <button className="button dark" disabled={busy}>
              Create restock request
            </button>
            <button type="button" disabled={busy} onClick={() => setRestock(null)}>
              Cancel restock
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Location</th>
              <th>Stock</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.items
              .filter(
                (i) =>
                  (!location || i.locationId === location) &&
                  (!lowOnly || i.quantity <= i.reorderPoint) &&
                  i.product.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((i) => (
                <tr key={i.id}>
                  <td>{i.product.name}</td>
                  <td>{i.location.name}</td>
                  <td>
                    <span className={i.quantity <= i.reorderPoint ? 'low-stock' : ''}>
                      {i.quantity}
                    </span>
                  </td>
                  <td>
                    <button
                      disabled={busy || !!adjustStock || !!restock}
                      onClick={() => {
                        setAdjustStock(i);
                        setAdjustmentMessage('');
                      }}
                    >
                      Set stock quantity
                    </button>
                    <button
                      disabled={
                        busy ||
                        !!adjustStock ||
                        !!restock ||
                        data.proposals.some(
                          (p) =>
                            p.product.id === i.productId &&
                            p.location.id === i.locationId &&
                            ['PROPOSED', 'APPROVED'].includes(p.status),
                        )
                      }
                      onClick={() => setRestock(i)}
                    >
                      Replenish stock
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h3>Replenishment proposals</h3>
      {data.proposals
        .filter(
          (p) =>
            (!location || p.location.id === location) &&
            p.product.name.toLowerCase().includes(search.toLowerCase()),
        )
        .map((p) => (
          <div className="record" key={p.id}>
            <strong>
              {p.product.name} · {p.quantity} units
            </strong>
            <p>
              {p.location.name} · {p.reason}
            </p>
            <span className="pill">{p.status}</span>
            <div className="inline-actions">
              {(p.status === 'PROPOSED'
                ? ['approve', 'reject']
                : p.status === 'APPROVED'
                  ? ['receive']
                  : []
              ).map((action) => (
                <button
                  key={action}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/operations/replenishment/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ action }),
                      });
                      await load();
                    })
                  }
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
export function KnowledgePanel({
  run,
  busy,
}: {
  run: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [docs, setDocs] = useState<Knowledge[]>([]);
  async function load() {
    setDocs(await api('/knowledge/documents'));
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <div className="stack">
      <p>
        Upload trusted documents, wait for ingestion, then activate the version for customer
        answers.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const body = new FormData();
          body.append('file', f.get('file')!);
          body.append(
            'metadata',
            JSON.stringify({
              title: f.get('title'),
              version: f.get('version'),
              category: f.get('category') || 'ALL',
              documentType: f.get('documentType'),
              country: 'IN',
              effectiveFrom: new Date(String(f.get('effectiveFrom'))).toISOString(),
              tiers: ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'],
              audience: ['CUSTOMER', 'STORE_MANAGER', 'ADMIN'],
            }),
          );
          void run(async () => {
            await api('/knowledge/documents', { method: 'POST', body });
            form.reset();
            await load();
          });
        }}
      >
        <div className="form-grid">
          <label>
            Document title
            <input name="title" required minLength={3} maxLength={120} disabled={busy} />
          </label>
          <label>
            Version
            <input name="version" required maxLength={30} disabled={busy} placeholder="2026.1" />
          </label>
          <label>
            Category
            <input name="category" maxLength={40} disabled={busy} placeholder="ALL" />
          </label>
          <label>
            Type
            <select name="documentType">
              <option>POLICY</option>
              <option>MANUAL</option>
              <option>PROCEDURE</option>
            </select>
          </label>
          <label>
            Effective from
            <input
              name="effectiveFrom"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            File
            <input
              name="file"
              type="file"
              accept=".pdf,.md,.txt,.json,.csv"
              required
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                const invalid =
                  file &&
                  (file.size > 4 * 1024 * 1024 || !/\.(pdf|md|txt|json|csv)$/i.test(file.name));
                e.currentTarget.setCustomValidity(
                  invalid
                    ? 'Choose a PDF, Markdown, text, JSON or CSV file smaller than 4 MB.'
                    : '',
                );
                if (invalid) e.currentTarget.reportValidity();
              }}
            />
          </label>
        </div>
        <small>
          India demo scope. Applies to all membership tiers and roles. Upload API supports narrower
          tier and audience metadata. Maximum 4 MB.
        </small>
        <button className="button dark" disabled={busy}>
          Upload for ingestion <Plus size={17} />
        </button>
      </form>
      <button className="text-button" disabled={busy} onClick={() => void run(load)}>
        Refresh ingestion status
      </button>
      {docs.map((d) => (
        <div className="record" key={d.id}>
          <div className="record-heading">
            <strong>
              {d.title} · {d.version}
            </strong>
            <span className="pill">{d.status === 'READY' && d.active ? 'ACTIVE' : d.status}</span>
          </div>
          <p>
            {d._count.chunks} chunks · {d.retrievalMode}
          </p>
          {d.error && <p>{d.error}</p>}
          {d.status === 'READY' && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/knowledge/documents/${d.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: !d.active }),
                  });
                  await load();
                })
              }
            >
              {d.active ? 'Retire version' : 'Activate version'}
            </button>
          )}
          {['READY', 'FAILED'].includes(d.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/knowledge/documents/${d.id}/reindex`, { method: 'POST' });
                  await load();
                })
              }
            >
              Rebuild embeddings
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
