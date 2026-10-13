import { z } from 'zod';

import { db } from '../config/database.js';

import { assert } from '../errors/HttpError.js';

import { storeAccess, type Actor } from '../middleware/authorize.js';

// Exact physical-count correction. Compare the reviewed version so concurrent sales/receipts
// cannot be overwritten. The approval ID also makes network retries safe.
export async function setStockQuantity(
  actor: Actor,
  inventoryId: string,
  raw: unknown,
  approvalId: string,
) {
  const input = z
    .object({
      quantity: z.number().int().min(0).max(1000000),
      reason: z.string().trim().min(5).max(500),
      stockVersion: z.string().datetime(),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${approvalId})::bigint)`;
    const item = await tx.inventory.findUnique({ where: { id: inventoryId } });
    assert(item, 404, 'NOT_FOUND', 'Inventory record not found.');
    storeAccess(actor, item.locationId);
    const completed = await tx.auditLog.findUnique({ where: { id: approvalId } });
    if (completed) return { ok: true };
    const changed = await tx.inventory.updateMany({
      where: { id: item.id, updatedAt: new Date(input.stockVersion) },
      data: { quantity: input.quantity },
    });
    assert(
      changed.count === 1,
      409,
      'STOCK_CHANGED',
      'Stock changed since you reviewed it. Review the current quantity again before confirming.',
    );
    await tx.auditLog.create({
      data: {
        id: approvalId,
        actorId: actor.id,
        action: 'STOCK_QUANTITY_SET',
        resourceId: item.id,
        details: {
          productId: item.productId,
          locationId: item.locationId,
          before: item.quantity,
          after: input.quantity,
          change: input.quantity - item.quantity,
          reason: input.reason,
        },
      },
    });
    return { ok: true };
  });
}

export async function getInventory(actor: Actor, query: Record<string, unknown>) {
  const locationId = typeof query.storeId === 'string' ? query.storeId : undefined;
  if (locationId) storeAccess(actor, locationId);
  const where = locationId
    ? { locationId }
    : actor.role === 'STORE_MANAGER'
      ? { locationId: { in: actor.storeIds } }
      : {};
  const items = await db.inventory.findMany({
    where,
    include: { product: true, location: true },
    orderBy: [{ quantity: 'asc' }, { id: 'asc' }],
  });
  const proposals = await db.replenishment.findMany({
    where,
    include: { product: true, location: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { items, proposals };
}

export async function createReplenishment(actor: Actor, inputBody: unknown, approvalId?: string) {
  const input = z
    .object({
      productId: z.string(),
      locationId: z.string(),
      quantity: z.number().int().min(1).max(1000),
      reason: z.string().trim().min(5).max(500),
    })
    .strict()
    .parse(inputBody);
  storeAccess(actor, input.locationId);
  assert(
    await db.inventory.findUnique({
      where: { productId_locationId: { productId: input.productId, locationId: input.locationId } },
    }),
    404,
    'NOT_FOUND',
    'Inventory record not found.',
  );
  const proposal = await db.$transaction(async (tx) => {
    // One pending replenishment per product/location prevents repeated clicks from over-ordering.
    const lockKey = `${input.productId}:${input.locationId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
    if (approvalId) {
      const completed = await tx.auditLog.findUnique({ where: { id: approvalId } });
      if (completed)
        return tx.replenishment.findUniqueOrThrow({ where: { id: completed.resourceId } });
    }
    assert(
      !(await tx.replenishment.findFirst({
        where: {
          productId: input.productId,
          locationId: input.locationId,
          status: { in: ['PROPOSED', 'APPROVED'] },
        },
      })),
      409,
      'ALREADY_PENDING',
      'This product already has a pending replenishment at this location.',
    );
    const p = await tx.replenishment.create({ data: { ...input, requestedBy: actor.id } });
    await tx.auditLog.create({
      data: {
        ...(approvalId ? { id: approvalId } : {}),
        actorId: actor.id,
        action: 'REPLENISHMENT_PROPOSED',
        resourceId: p.id,
        details: input,
      },
    });
    return p;
  });
  return proposal;
}

export async function updateReplenishment(actor: Actor, inputBody: unknown, id: string) {
  const { action } = z
    .object({ action: z.enum(['approve', 'reject', 'receive']) })
    .parse(inputBody);
  await db.$transaction(async (tx) => {
    const p = await tx.replenishment.findUnique({ where: { id: String(id) } });
    assert(p, 404, 'NOT_FOUND', 'Proposal not found.');
    storeAccess(actor, p.locationId);
    const from = action === 'receive' ? 'APPROVED' : 'PROPOSED';
    const to = action === 'receive' ? 'RECEIVED' : action === 'approve' ? 'APPROVED' : 'REJECTED';
    const changed = await tx.replenishment.updateMany({
      where: { id: p.id, status: from },
      data: { status: to, ...(action === 'approve' ? { approvedBy: actor.id } : {}) },
    });
    assert(
      changed.count === 1,
      409,
      'INVALID_TRANSITION',
      'Proposal was already updated or is not ready for this action.',
    );
    if (action === 'receive')
      await tx.inventory.update({
        where: { productId_locationId: { productId: p.productId, locationId: p.locationId } },
        data: { quantity: { increment: p.quantity } },
      });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: `REPLENISHMENT_${to}`,
        resourceId: p.id,
        details: { quantity: p.quantity },
      },
    });
  });
  return { ok: true };
}

export async function listAudit(actor: Actor) {
  return await db.auditLog.findMany({
    where: actor.role === 'ADMIN' ? {} : { actorId: actor.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function listUsers() {
  return await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tier: true,
      active: true,
      assignments: { select: { locationId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
export async function listLocations() {
  return db.location.findMany({ orderBy: { name: 'asc' } });
}

export async function updateUser(actor: Actor, inputBody: unknown, id: string) {
  const input = z
    .object({
      tier: z.enum(['STANDARD', 'SILVER', 'GOLD', 'PLATINUM']).optional(),
      active: z.boolean().optional(),
      role: z.enum(['CUSTOMER', 'STORE_MANAGER', 'ADMIN']).optional(),
      storeIds: z.array(z.string().min(1)).max(20).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0)
    .parse(inputBody);
  assert(
    String(id) !== actor.id || (input.active !== false && (!input.role || input.role === 'ADMIN')),
    400,
    'SELF_DISABLE',
    'You cannot disable your own account or remove your own administrator role.',
  );
  const user = await db.$transaction(async (tx) => {
    // Serialize privileged account changes so simultaneous requests cannot remove the last administrator.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('retailpulse-admin-access')::bigint)`;
    const current = await tx.user.findUnique({ where: { id }, include: { assignments: true } });
    assert(current, 404, 'NOT_FOUND', 'Account not found.');
    if (
      current.role === 'ADMIN' &&
      current.active &&
      (input.active === false || (input.role && input.role !== 'ADMIN'))
    )
      assert(
        (await tx.user.count({ where: { role: 'ADMIN', active: true } })) > 1,
        409,
        'LAST_ADMIN',
        'At least one active administrator is required.',
      );
    const role = input.role || current.role;
    const storeIds = [...new Set(input.storeIds || current.assignments.map((a) => a.locationId))];
    if (role === 'STORE_MANAGER') {
      assert(
        storeIds.length > 0,
        400,
        'STORE_REQUIRED',
        'Assign at least one location to the manager.',
      );
      assert(
        (await tx.location.count({ where: { id: { in: storeIds } } })) === storeIds.length,
        400,
        'INVALID_STORE',
        'One of the assigned locations does not exist.',
      );
    } else
      assert(
        !input.storeIds?.length,
        400,
        'INVALID_ASSIGNMENT',
        'Store assignments apply only to managers.',
      );
    const { storeIds: _assignments, ...data } = input;
    const u = await tx.user.update({ where: { id }, data });
    if (input.storeIds || input.role) {
      await tx.storeAssignment.deleteMany({ where: { userId: id } });
      if (role === 'STORE_MANAGER')
        await tx.storeAssignment.createMany({
          data: storeIds.map((locationId) => ({ userId: id, locationId })),
        });
    }
    if (input.active === false)
      await tx.authSession.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'USER_UPDATED', resourceId: u.id, details: input },
    });
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      tier: u.tier,
      active: u.active,
      storeIds: role === 'STORE_MANAGER' ? storeIds : [],
    };
  });
  return user;
}
