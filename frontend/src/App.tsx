import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ShoppingBag,
  Search,
  MapPin,
  ArrowUpRight,
  Sparkles,
  X,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Check,
  SlidersHorizontal,
  Package,
  LogOut,
  ShieldCheck,
  MessageCircle,
  Headphones,
  ArrowRight,
} from 'lucide-react';
import {
  api,
  money,
  restoreSession,
  setToken,
  type User,
  type Product,
  type Catalogue,
  type Store,
  type CartLine,
  type Quote,
  type Order,
  type Ticket,
  type Inventory,
  type Proposal,
  type Knowledge,
  type Answer,
  type Recommendations,
} from './api';
import { ProductArt } from './ProductArt';
import { AdminPanel } from './components/AdminPanel';
import { Support } from './components/Support';
import { Chatbot, type ChatMessage } from './components/Chatbot';
import {
  Login,
  Cart,
  Preferences,
  Orders,
  Operations,
  KnowledgePanel,
} from './components/Features';
type Panel =
  | 'login'
  | 'cart'
  | 'assistant'
  | 'orders'
  | 'preferences'
  | 'support'
  | 'operations'
  | 'knowledge'
  | 'admin'
  | null;
// Native dialogs occupy the browser's top layer, so feedback must render inside them.
const FeedbackContext = createContext<ReactNode>(null);
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : ''}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Close">
          <X />
        </button>
      </header>
      {useContext(FeedbackContext)}
      {children}
    </dialog>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('store-bengaluru');
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    brand: '',
    sort: 'featured',
    maxPrice: '',
    specification: '',
    minRating: '',
    inStock: false,
    page: 1,
    limit: 8,
  });
  const [search, setSearch] = useState('');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // Clear conversation on account changes so another customer never inherits this page's chat.
  useEffect(() => {
    setChatMessages([]);
  }, [user?.id]);
  const checkoutKey = useRef(crypto.randomUUID());
  const customer = user?.role === 'CUSTOMER';
  const close = () => {
    if (panel === 'operations' || panel === 'orders') setRevision((n) => n + 1);
    setPanel(null);
  };
  // Cancel obsolete catalogue requests when filters change; an older response must never replace newer results.
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const q = new URLSearchParams({
      storeId,
      sort: filters.sort,
      page: String(filters.page),
      limit: String(filters.limit),
    });
    for (const key of [
      'search',
      'category',
      'brand',
      'maxPrice',
      'specification',
      'minRating',
    ] as const)
      if (filters[key]) q.set(key, filters[key]);
    if (Object.keys(attributes).length) q.set('attributes', JSON.stringify(attributes));
    if (filters.inStock) q.set('inStock', 'true');
    api<Catalogue>(`/products?${q}`, { signal: abort.signal })
      .then(setCatalogue)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [filters, attributes, storeId, revision]);
  useEffect(() => {
    api<Store[]>('/stores')
      .then(setStores)
      .catch((e) => setError(e.message));
    restoreSession()
      .then((s) => {
        setUser(s.user);
        if (s.user.preferences?.storeId) setStoreId(s.user.preferences.storeId);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (customer)
      api<CartLine[]>('/cart')
        .then(setCart)
        .catch((e) => setError(e.message));
    else setCart([]);
  }, [customer, user?.id]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  async function quantity(productId: string, count: number) {
    await api(`/cart/${productId}`, { method: 'PUT', body: JSON.stringify({ quantity: count }) });
    // Keep controls busy until the displayed quantity reflects the saved cart.
    setCart(await api<CartLine[]>('/cart'));
    checkoutKey.current = crypto.randomUUID();
    setRevision((n) => n + 1);
  }
  function add(p: Product) {
    if (!user) {
      setPanel('login');
      return;
    }
    void run(async () => {
      await quantity(p.id, (cart.find((c) => c.productId === p.id)?.quantity || 0) + 1);
      setNotice(`${p.name} added to your bag.`);
    });
  }
  function filter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    if (key === 'category') setAttributes({});
    setFilters((f) => ({
      ...f,
      ...(key === 'category' ? { brand: '' } : {}),
      [key]: value,
      ...(key !== 'page' ? { page: 1 } : {}),
    }));
  }
  async function showProduct(p: Product) {
    await run(async () => setDetail(await api<Product>(`/products/${p.id}`)));
  }
  const feedback = (
    <>
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
  return (
    <FeedbackContext.Provider value={feedback}>
      <div className="announcement">
        <span>Thoughtful finds. Everyday possibilities.</span>
        <span>
          Free store pickup on every order <ArrowUpRight size={13} />
        </span>
      </div>
      <header className="site-header">
        <a className="logo" href="#" aria-label="RetailPulse home">
          <span className="logo-mark">
            r<span>p</span>
          </span>
          RetailPulse<span className="ai-badge">AI</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#catalogue" className="active">
            Discover
          </a>
          <button onClick={() => setPanel(user ? 'orders' : 'login')}>Orders</button>
          <button onClick={() => setPanel(user ? 'support' : 'login')}>Support</button>
          {user && !customer && <button onClick={() => setPanel('operations')}>Operations</button>}
          {user?.role === 'ADMIN' && (
            <button onClick={() => setPanel('knowledge')}>Knowledge</button>
          )}
          {user?.role === 'ADMIN' && <button onClick={() => setPanel('admin')}>Admin</button>}
        </nav>
        <div className="header-actions">
          <button className="account" onClick={() => setPanel(user ? 'preferences' : 'login')}>
            {user ? user.name.split(' ')[0] : 'Sign in'}
            {customer && <small>{user.tier.toLowerCase()}</small>}
          </button>
          {user && (
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                void run(async () => {
                  await api('/auth/logout', { method: 'POST' });
                  setToken('');
                  setUser(null);
                  close();
                })
              }
            >
              <LogOut size={18} />
            </button>
          )}
          {(!user || customer) && (
            <button
              className="bag-button"
              aria-label={`Shopping bag with ${cart.reduce((n, c) => n + c.quantity, 0)} items`}
              onClick={() => setPanel(user ? 'cart' : 'login')}
            >
              <ShoppingBag size={20} />
              <span>{cart.reduce((n, c) => n + c.quantity, 0)}</span>
            </button>
          )}
        </div>
      </header>
      {user?.role === 'STORE_MANAGER' && (
        <div className="manager-scope" role="status">
          <strong>Store manager</strong> · Assigned locations:{' '}
          {user.managedLocations?.length
            ? user.managedLocations.map((s) => `${s.name}, ${s.city}`).join(' · ')
            : 'No locations assigned. Contact an administrator.'}
        </div>
      )}
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> A LITTLE SMARTER. A LOT MORE YOU.
            </div>
            <h1>
              Good finds.
              <br />
              Made <em>personal.</em>
            </h1>
            <p>
              Discover everyday essentials and your next favourite.
              <br className="desktop" /> A little help from AI. A whole lot of possibility.
            </p>
            <a className="button dark" href="#catalogue">
              Explore the collection <ArrowUpRight size={18} />
            </a>
            <button className="hero-ai" onClick={() => setPanel(user ? 'assistant' : 'login')}>
              <Sparkles size={16} /> Find it with AI <ArrowRight size={15} />
            </button>
            <div className="hero-foot">
              <span>
                <ShieldCheck size={16} /> Trusted policy answers
              </span>
              <span>
                <MapPin size={16} /> Real store availability
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="orb" />
            <span className="hero-label">THE EVERYDAY EDIT</span>
            <div className="hero-headphones">
              <Headphones strokeWidth={1} />
            </div>
            <div className="floating-note">
              <span className="little-spark">
                <Sparkles size={17} />
              </span>
              <div>
                Less searching.<strong>More finding your thing.</strong>
              </div>
            </div>
            <span className="visual-caption">
              CURATED FOR YOUR EVERYDAY <span>01 / 03</span>
            </span>
          </div>
        </section>
        <section className="benefits">
          <span>
            <Package /> Pick up close to home
          </span>
          <span>
            <ShieldCheck /> Clear policies. Trusted sources.
          </span>
          <span>
            <Sparkles /> Recommendations with a reason
          </span>
        </section>
        <section id="catalogue" className="catalogue-section">
          <div className="section-intro">
            <div className="eyebrow">DISCOVER SOMETHING GOOD</div>
            <div className="section-title">
              <h2>Your everyday, upgraded.</h2>
              <label className="store-picker">
                <MapPin size={17} />
                <select
                  aria-label="Select store"
                  value={storeId}
                  onChange={(e) => {
                    setStoreId(e.target.value);
                    setAttributes({});
                    setFilters((current) => ({ ...current, brand: '', page: 1 }));
                    filter('page', 1);
                  }}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}, {s.city}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>Explore our collection. Find what fits your life.</p>
          </div>
          <div className="discovery-toolbar">
            <div className="category-tabs">
              {['', ...(catalogue?.categories || [])].map((c) => (
                <button
                  key={c}
                  className={filters.category === c ? 'selected' : ''}
                  onClick={() => filter('category', c)}
                >
                  {c || 'All products'}
                </button>
              ))}
            </div>
            <button
              className="assistant-trigger"
              onClick={() => setPanel(user ? 'assistant' : 'login')}
            >
              <Sparkles size={16} /> Help me choose
            </button>
          </div>
          <div className="filter-bar">
            <form
              className="search-field"
              onSubmit={(e) => {
                e.preventDefault();
                filter('search', search);
              }}
            >
              <Search size={18} />
              <input
                aria-label="Search products"
                placeholder="Search something you’ll love…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" aria-label="Submit search">
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="filter-controls">
              <SlidersHorizontal size={16} />
              <select
                aria-label="Filter by brand"
                value={filters.brand}
                onChange={(e) => filter('brand', e.target.value)}
              >
                <option value="">All brands</option>
                {catalogue?.brands.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <input
                className="budget"
                type="number"
                min="1"
                placeholder="Max price ₹"
                aria-label="Maximum price"
                value={filters.maxPrice}
                onChange={(e) => filter('maxPrice', e.target.value)}
              />
              <input
                className="budget"
                aria-label="Filter by specification"
                placeholder="Search specifications"
                value={filters.specification}
                onChange={(e) => filter('specification', e.target.value)}
              />
              <select
                aria-label="Minimum rating"
                value={filters.minRating}
                onChange={(e) => filter('minRating', e.target.value)}
              >
                <option value="">Any rating</option>
                <option value="4">4 stars and above</option>
                <option value="4.5">4.5 stars and above</option>
              </select>
              <label className="stock-check">
                <input
                  type="checkbox"
                  checked={filters.inStock}
                  onChange={(e) => filter('inStock', e.target.checked)}
                />{' '}
                In stock
              </label>
              <select
                aria-label="Sort products"
                value={filters.sort}
                onChange={(e) => filter('sort', e.target.value)}
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="rating">Top rated</option>
              </select>
            </div>
          </div>
          {filters.category && Object.keys(catalogue?.attributeOptions || {}).length > 0 && (
            <div
              className="filter-controls category-specifications"
              aria-label={`${filters.category} specification filters`}
            >
              {Object.entries(catalogue?.attributeOptions || {}).map(([key, values]) => (
                <label key={key}>
                  {key}
                  <select
                    aria-label={`Filter by ${key}`}
                    value={attributes[key] || ''}
                    onChange={(e) => {
                      setAttributes((current) => {
                        const next = { ...current };
                        if (e.target.value) next[key] = e.target.value;
                        else delete next[key];
                        return next;
                      });
                      setFilters((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <option value="">All</option>
                    {values.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="results-caption">
            <span aria-live="polite">
              {loading ? 'Finding your favourites…' : `${catalogue?.total || 0} thoughtful finds`}
            </span>
            {(filters.search ||
              filters.specification ||
              filters.category ||
              filters.brand ||
              filters.maxPrice ||
              filters.minRating ||
              Object.keys(attributes).length > 0 ||
              filters.inStock) && (
              <button
                onClick={() => {
                  setSearch('');
                  setAttributes({});
                  setFilters({
                    search: '',
                    category: '',
                    brand: '',
                    sort: 'featured',
                    maxPrice: '',
                    specification: '',
                    minRating: '',
                    inStock: false,
                    page: 1,
                    limit: 8,
                  });
                }}
              >
                Clear filters
              </button>
            )}
            <label>
              Show{' '}
              <select
                aria-label="Products per page"
                value={filters.limit}
                onChange={(e) => filter('limit', Number(e.target.value))}
              >
                <option value="8">8</option>
                <option value="12">12</option>
                <option value="24">24</option>
              </select>{' '}
              per page
            </label>
          </div>
          <div className={`product-grid ${loading ? 'loading' : ''}`}>
            {catalogue?.items.map((p) => (
              <article className="product-card" key={p.id}>
                <button className="product-image-button" onClick={() => void showProduct(p)}>
                  <ProductArt name={p.name} color={p.color} />
                  {p.originalPrice && <span className="product-tag">Everyday value</span>}
                  <span className="detail-arrow">
                    <ArrowUpRight size={18} />
                  </span>
                </button>
                <div className="product-meta">
                  <span>
                    {p.brand} / {p.category}
                  </span>
                  <span className="rating">★ {p.rating}</span>
                </div>
                <button className="product-name" onClick={() => void showProduct(p)}>
                  {p.name}
                </button>
                <p className="product-description">{p.description}</p>
                <div className="price-row">
                  <div>
                    <strong>{money(p.price)}</strong>
                    {p.originalPrice && <del>{money(p.originalPrice)}</del>}
                  </div>
                  {(!user || customer) && (
                    <button
                      className="add-button"
                      disabled={busy || !p.availability}
                      onClick={() => add(p)}
                      aria-label={`Add ${p.name} to bag`}
                    >
                      <Plus size={19} />
                    </button>
                  )}
                </div>
                <div className={`availability ${!p.availability ? 'unavailable' : ''}`}>
                  <span />
                  {p.availability
                    ? `${p.availability} available at your store`
                    : 'Unavailable at your store'}
                </div>
              </article>
            ))}
          </div>
          {!loading && !catalogue?.items.length && (
            <div className="empty-state">
              <Search />
              <h3>No matches yet</h3>
              <p>Try another search or adjust your filters.</p>
            </div>
          )}
          <div className="pagination">
            <span>
              Page {catalogue?.page || 1} of {Math.max(1, catalogue?.pages || 0)}
            </span>
            <div>
              <button
                aria-label="Previous page"
                disabled={filters.page <= 1 || loading}
                onClick={() => filter('page', filters.page - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              {Array.from({ length: catalogue?.pages || 0 }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === catalogue?.pages || Math.abs(n - filters.page) <= 1)
                .map((n) => (
                  <button
                    key={n}
                    aria-current={n === filters.page ? 'page' : undefined}
                    className={n === filters.page ? 'selected' : ''}
                    onClick={() => filter('page', n)}
                  >
                    {n}
                  </button>
                ))}
              <button
                aria-label="Next page"
                disabled={!catalogue || filters.page >= catalogue.pages || loading}
                onClick={() => filter('page', filters.page + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <span>
              Stock checked for {stores.find((s) => s.id === storeId)?.name || 'your store'}
            </span>
          </div>
        </section>
        <section className="assistant-banner">
          <span className="banner-icon">
            <Sparkles />
          </span>
          <div>
            <h2>A question away from your next favourite.</h2>
            <p>Tell us what you need, or ask about a store policy. We’ll help you find your way.</p>
          </div>
          <button className="button dark" onClick={() => setPanel(user ? 'assistant' : 'login')}>
            Open chatbot <MessageCircle size={17} />
          </button>
        </section>
      </main>
      <footer>
        <a className="logo" href="#">
          RetailPulse<span className="ai-badge">AI</span>
        </a>
        <span>Everyday retail, with a thoughtful touch.</span>
        <small>Hackathon MVP · Sample products and policies · Payments simulated</small>
      </footer>
      {!panel && !detail && feedback}
      {detail && (
        <Modal title={detail.name} close={() => setDetail(null)} wide>
          <div className="product-detail">
            <ProductArt name={detail.name} color={detail.color} />
            <div>
              <div className="eyebrow">
                {detail.brand} / {detail.category}
              </div>
              <h3>{money(detail.price)}</h3>
              <p>{detail.description}</p>
              <ul>
                {detail.specifications.highlights?.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <h4>Availability by location</h4>
              {detail.inventory?.map((i) => (
                <p key={i.location.id}>
                  {i.location.name}: <strong>{i.quantity} in stock</strong>
                </p>
              ))}
              {(!user || customer) && (
                <button className="button dark" disabled={busy} onClick={() => add(detail)}>
                  Add to bag <Plus size={17} />
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {panel === 'login' && (
        <Modal title="Welcome to RetailPulse" close={close}>
          <Login
            busy={busy}
            submit={(data) =>
              void run(async () => {
                const s = await api<{ accessToken: string; user: User }>(
                  `/auth/${data.name ? 'register' : 'login'}`,
                  { method: 'POST', body: JSON.stringify(data) },
                );
                setToken(s.accessToken);
                setUser(s.user);
                if (s.user.preferences?.storeId) setStoreId(s.user.preferences.storeId);
                close();
                setNotice(`Welcome, ${s.user.name}.`);
              })
            }
          />
        </Modal>
      )}
      {panel === 'cart' && (
        <Modal title="Your shopping bag" close={close}>
          <Cart
            cart={cart}
            busy={busy}
            storeId={storeId}
            checkoutKey={checkoutKey.current}
            quantity={(id, n) => void run(() => quantity(id, n))}
            submit={(task) => void run(task)}
            done={() => {
              setCart([]);
              setRevision((n) => n + 1);
              checkoutKey.current = crypto.randomUUID();
              setPanel('orders');
              setNotice('Order placed. Payment was simulated.');
            }}
          />
        </Modal>
      )}
      {panel === 'assistant' && user && (
        <Modal title="RetailPulse chatbot" close={close}>
          <Chatbot
            openAction={(nextPanel, requestedStore) => {
              if (requestedStore) setStoreId(requestedStore);
              if (nextPanel === 'cart')
                void run(async () => {
                  setCart(await api<CartLine[]>('/cart'));
                  setPanel(nextPanel);
                });
              else setPanel(nextPanel);
            }}
            openProduct={(id, requestedStore) =>
              void run(async () => {
                setDetail(await api<Product>(`/products/${id}`));
                if (requestedStore) setStoreId(requestedStore);
                setPanel(null);
              })
            }
            messages={chatMessages}
            setMessages={setChatMessages}
            storeId={storeId}
            customer={Boolean(customer)}
            managedLocations={
              user.role === 'STORE_MANAGER'
                ? user.managedLocations?.map((s) => `${s.name}, ${s.city}`).join(' · ') ||
                  'No assigned locations'
                : undefined
            }
          />
        </Modal>
      )}
      {panel === 'preferences' && user && (
        <Modal title="Your profile and preferences" close={close}>
          <Preferences
            user={user}
            categories={catalogue?.categories || []}
            stores={stores}
            busy={busy}
            save={(data) =>
              void run(async () => {
                const updated = await api<User>('/auth/me', {
                  method: 'PATCH',
                  body: JSON.stringify(data),
                });
                setUser(updated);
                if (updated.preferences?.storeId) setStoreId(updated.preferences.storeId);
                setNotice('Your preferences have been saved.');
                close();
              })
            }
          />
        </Modal>
      )}
      {panel === 'orders' && user && (
        <Modal title={customer ? 'Your orders' : 'Store orders'} close={close} wide>
          <Orders customer={Boolean(customer)} run={run} busy={busy} />
        </Modal>
      )}
      {panel === 'support' && user && (
        <Modal title="Support that follows through" close={close}>
          <Support storeId={storeId} role={user.role} run={run} />
        </Modal>
      )}
      {panel === 'operations' && user && (
        <Modal title="Store operations" close={close} wide>
          <Operations run={run} busy={busy} />
        </Modal>
      )}
      {panel === 'knowledge' && user?.role === 'ADMIN' && (
        <Modal title="Approved retail knowledge" close={close} wide>
          <KnowledgePanel run={run} busy={busy} />
        </Modal>
      )}
      {panel === 'admin' && user?.role === 'ADMIN' && (
        <Modal title="Administration" close={close} wide>
          <AdminPanel currentUserId={user.id} run={run} />
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
}
