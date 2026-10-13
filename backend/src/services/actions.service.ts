import type { Actor } from '../middleware/authorize.js';
type Action = {
  id: string;
  label: string;
  panel: 'orders' | 'support' | 'operations' | 'knowledge' | 'admin';
  description: string;
};
const orders: Action = {
  id: 'orders',
  label: 'My orders',
  panel: 'orders',
  description: 'View progress and review available order actions.',
};
const support: Action = {
  id: 'support',
  label: 'Support tickets',
  panel: 'support',
  description: 'Open support and review the actions permitted for your role.',
};
const stock: Action = {
  id: 'replenishment',
  label: 'Inventory & replenishment',
  panel: 'operations',
  description:
    'Review stock, request replenishment, approve and receive it at permitted locations.',
};
// This allowlist is derived from authenticated server roles, never from model output.
// Existing action endpoints independently enforce ownership, assignments and valid transitions.
export function approvedActions(actor: Actor): Action[] {
  if (actor.role === 'CUSTOMER') return [orders, support];
  const staffOrders = { ...orders, label: 'Manage orders' };
  if (actor.role === 'STORE_MANAGER') return [staffOrders, stock, support];
  return [
    staffOrders,
    stock,
    support,
    {
      id: 'policies',
      label: 'Manage policies',
      panel: 'knowledge',
      description: 'Upload, rebuild embeddings, activate or retire policy versions.',
    },
    {
      id: 'accounts',
      label: 'Accounts & access',
      panel: 'admin',
      description: 'Review and save membership, role and location assignments.',
    },
  ];
}
