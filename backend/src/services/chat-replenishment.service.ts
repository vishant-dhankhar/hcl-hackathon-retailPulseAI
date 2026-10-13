import { db } from '../config/database.js';
import { assert } from '../errors/HttpError.js';
import { storeAccess, type Actor } from '../middleware/authorize.js';
import type { ChatAction } from './chat-actions.service.js';

// These actions reflect the saved workflow state; model text cannot grant approval permissions.
export function replenishmentCard(p: {
  id: string;
  quantity: number;
  status: string;
  reason: string;
  product: { name: string };
  location: { name: string; city: string };
}) {
  const actions: ChatAction[] =
    p.status === 'PROPOSED'
      ? [
          { kind: 'APPROVE_STOCK', targetId: p.id, label: 'Approve request' },
          { kind: 'REJECT_STOCK', targetId: p.id, label: 'Reject request' },
        ]
      : p.status === 'APPROVED'
        ? [{ kind: 'RECEIVE_STOCK', targetId: p.id, label: 'Receive stock' }]
        : [];
  return {
    id: p.id,
    title: `${p.product.name} — replenishment request`,
    detail: `${p.location.name}, ${p.location.city} · ${p.quantity} units · ${p.status}\n${p.reason}`,
    actions,
  };
}

export async function pendingReplenishment(actor: Actor, inventoryId: string) {
  assert(
    actor.role !== 'CUSTOMER',
    403,
    'FORBIDDEN',
    'Only authorized staff can handle inventory.',
  );
  const item = await db.inventory.findUnique({ where: { id: inventoryId } });
  assert(item, 404, 'NOT_FOUND', 'Inventory record not found.');
  storeAccess(actor, item.locationId);
  return db.replenishment.findFirst({
    where: {
      productId: item.productId,
      locationId: item.locationId,
      status: { in: ['PROPOSED', 'APPROVED'] },
    },
    include: { product: true, location: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

export function existingReplenishment(p: Parameters<typeof replenishmentCard>[0]) {
  return {
    existingRequest: true,
    message: `An existing replenishment request was found. ${p.status === 'PROPOSED' ? 'Review it below to approve or reject it.' : 'It is already approved. Receive stock only after the units arrive.'} No duplicate request was created.`,
    records: [replenishmentCard(p)],
  };
}
