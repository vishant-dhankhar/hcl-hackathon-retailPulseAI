import { useEffect, useState, type FormEvent } from 'react';
import { api, type Store, type User } from '../api';
type Account = User & { active: boolean; assignments: { locationId: string }[] };
type Audit = { id: string; action: string; actorId: string; createdAt: string; resourceId: string };
export function AdminPanel({
  currentUserId,
  run,
}: {
  currentUserId: string;
  run: (task: () => Promise<void>) => Promise<void>;
}) {
  const [users, setUsers] = useState<Account[]>([]);
  const [locations, setLocations] = useState<Store[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tab, setTab] = useState('accounts');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [loaded, setLoaded] = useState(false);
  async function load() {
    const [accounts, stores, events] = await Promise.all([
      api<Account[]>('/operations/users'),
      api<Store[]>('/operations/locations'),
      api<Audit[]>('/operations/audit'),
    ]);
    setUsers(accounts);
    setLocations(stores);
    setAudit(events);
    setLoaded(true);
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <div className="stack">
      <div className="category-tabs">
        <button className={tab === 'accounts' ? 'selected' : ''} onClick={() => setTab('accounts')}>
          Accounts and access
        </button>
        <button className={tab === 'audit' ? 'selected' : ''} onClick={() => setTab('audit')}>
          Action history
        </button>
      </div>
      {!loaded && <p role="status">Loading administration…</p>}
      <button className="text-button" disabled={saving} onClick={() => void run(load)}>
        Refresh administration
      </button>
      {tab === 'accounts' ? (
        <>
          <p>
            Membership controls customer benefits. Roles and assigned locations control staff
            access. Save each change explicitly.
          </p>
          <div className="filter-controls">
            <input
              aria-label="Search accounts"
              placeholder="Name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Filter account role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">All roles</option>
              <option value="CUSTOMER">Customers</option>
              <option value="STORE_MANAGER">Store managers</option>
              <option value="ADMIN">Admins</option>
            </select>
          </div>
          {users
            .filter(
              (u) =>
                (roleFilter === 'ALL' || u.role === roleFilter) &&
                `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((u) => (
              <AccountForm
                key={`${u.id}-${u.role}-${u.tier}-${u.active}-${u.assignments.map((a) => a.locationId).join()}`}
                user={u}
                stores={locations}
                self={u.id === currentUserId}
                busy={saving}
                save={(data) =>
                  void run(async () => {
                    setSaving(true);
                    try {
                      await api(`/operations/users/${u.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify(data),
                      });
                      await load();
                    } finally {
                      setSaving(false);
                    }
                  })
                }
              />
            ))}
        </>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>{a.action.replaceAll('_', ' ')}</td>
                  <td>{users.find((u) => u.id === a.actorId)?.name || a.actorId}</td>
                  <td>{a.resourceId}</td>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function AccountForm({
  user,
  stores,
  self,
  busy,
  save,
}: {
  user: Account;
  stores: Store[];
  self: boolean;
  busy: boolean;
  save: (input: unknown) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [assigned, setAssigned] = useState(user.assignments.map((a) => a.locationId));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save({
      role,
      tier: f.get('tier'),
      active: self ? true : f.get('active') === 'on',
      storeIds: role === 'STORE_MANAGER' ? assigned : [],
    });
  }
  return (
    <form className="record stack" onSubmit={submit}>
      <strong>{user.name}</strong>
      <small>{user.email}</small>
      <div className="form-grid">
        <label>
          Access role
          <select
            value={role}
            disabled={self}
            onChange={(e) => setRole(e.target.value as User['role'])}
          >
            <option value="CUSTOMER">Customer</option>
            <option value="STORE_MANAGER">Store manager</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <label>
          Membership
          <select name="tier" defaultValue={user.tier}>
            {['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      {role === 'STORE_MANAGER' && (
        <fieldset>
          <legend>Assigned locations</legend>
          {stores.map((s) => (
            <label key={s.id} className="check-label">
              <input
                type="checkbox"
                checked={assigned.includes(s.id)}
                onChange={(e) =>
                  setAssigned(
                    e.target.checked ? [...assigned, s.id] : assigned.filter((id) => id !== s.id),
                  )
                }
              />
              {s.name}, {s.city}
            </label>
          ))}
        </fieldset>
      )}
      <label className="check-label">
        <input name="active" type="checkbox" defaultChecked={user.active} disabled={self} /> Account
        active
      </label>
      <button className="button dark" disabled={busy}>
        Save account changes
      </button>
    </form>
  );
}
