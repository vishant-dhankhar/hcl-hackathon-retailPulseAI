import { z } from 'zod';

import { createHash, randomUUID } from 'node:crypto';

import { db } from '../config/database.js';

import { assert } from '../errors/HttpError.js';

import { deliveryPaise, toPaise, rupees, canTransition } from '../lib/pricing.js';

import type { Prisma } from '../generated/prisma/client.js';

const checkoutInput = z
  .object({
    storeId: z.string().min(1),
    fulfillment: z.enum(['PICKUP', 'DELIVERY']),
    express: z.boolean().default(false),
    address: z.string().trim().min(10).max(500).optional(),
  })
  .strict();

async function quote(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof checkoutInput>,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const cart = await tx.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { productId: 'asc' },
  });
  assert(cart.length, 400, 'EMPTY_CART', 'Add a product to your bag first.');
  const store = await tx.location.findUnique({ where: { id: input.storeId, warehouse: false } });
  assert(store, 400, 'INVALID_STORE', 'Select a valid store.');
  if (input.fulfillment === 'DELIVERY') {
    assert(input.address, 400, 'ADDRESS_REQUIRED', 'Add your delivery address.');
    assert(
      !input.express || store.expressAvailable,
      400,
      'NOT_SERVICEABLE',
      'Express delivery is unavailable here.',
    );
  }
  const location =
    input.fulfillment === 'PICKUP'
      ? store
      : await tx.location.findFirst({ where: { warehouse: true }, orderBy: { id: 'asc' } });
  assert(location, 409, 'NO_FULFILLMENT_LOCATION', 'No fulfillment location is configured.');
  const lines = await Promise.all(
    cart.map(async (i) => {
      assert(i.product.active, 409, 'PRODUCT_UNAVAILABLE', `${i.product.name} is unavailable.`);
      const stock = await tx.inventory.findUnique({
        where: { productId_locationId: { productId: i.productId, locationId: location.id } },
      });
      assert(
        stock && stock.quantity >= i.quantity,
        409,
        'OUT_OF_STOCK',
        `${i.product.name} does not have enough stock at ${location.name}.`,
      );
      return {
        productId: i.productId,
        name: i.product.name,
        quantity: i.quantity,
        unitPrice: i.product.price.toString(),
      };
    }),
  );
  const subtotalPaise = lines.reduce((sum, l) => sum + toPaise(l.unitPrice) * l.quantity, 0);
  const fee = deliveryPaise(user.tier, subtotalPaise, input.fulfillment, input.express);
  const result = {
    lines,
    locationId: location.id,
    locationName: location.name,
    tier: user.tier,
    subtotal: rupees(subtotalPaise),
    deliveryCharge: rupees(fee),
    total: rupees(subtotalPaise + fee),
    fulfillment: input.fulfillment,
    express: input.express,
    address: input.address || null,
  };
  return {
    ...result,
    quoteHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
  };
}

import { storeAccess, type Actor } from '../middleware/authorize.js';

export async function getCart(actor: Actor) {
  return await db.cartItem.findMany({
    where: { userId: actor.id },
    include: { product: true },
    orderBy: { id: 'asc' },
  });
}

export async function updateCart(actor: Actor, inputBody: unknown, productId: string) {
  const { quantity } = z
    .object({ quantity: z.number().int().min(0).max(99) })
    .strict()
    .parse(inputBody);
  assert(
    await db.product.findUnique({ where: { id: productId, active: true } }),
    404,
    'NOT_FOUND',
    'Product not found.',
  );
  if (!quantity) await db.cartItem.deleteMany({ where: { userId: actor.id, productId } });
  else
    await db.cartItem.upsert({
      where: { userId_productId: { userId: actor.id, productId } },
      update: { quantity },
      create: { userId: actor.id, productId, quantity },
    });
  return { ok: true };
}

export async function getQuote(actor: Actor, inputBody: unknown) {
  return await quote(db, actor.id, checkoutInput.parse(inputBody));
}

export async function checkout(actor: Actor, inputBody: unknown, idempotencyKey: unknown) {
  const { quoteHash, ...input } = checkoutInput
    .extend({ quoteHash: z.string().length(64) })
    .parse(inputBody);
  const key = z.string().min(10).max(100).parse(idempotencyKey);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ ...input, quoteHash }))
    .digest('hex');
  const result = await db.$transaction(
    async (tx) => {
      // Serialize this customer's checkouts, including different retry keys, before reading and consuming the cart.
      // Select an integer because Prisma cannot deserialize PostgreSQL's void return type.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
      const existing = await tx.order.findUnique({
        where: { userId_idempotencyKey: { userId: actor.id, idempotencyKey: key } },
        include: { items: true, location: true },
      });
      if (existing) {
        assert(
          existing.requestHash === requestHash,
          409,
          'KEY_REUSED',
          'This checkout key was already used for another request.',
        );
        return existing;
      }
      const q = await quote(tx, actor.id, input);
      assert(
        q.quoteHash === quoteHash,
        409,
        'QUOTE_CHANGED',
        'Your bag, price or membership changed. Review a fresh quote.',
      );
      for (const l of q.lines) {
        const changed = await tx.inventory.updateMany({
          where: {
            productId: l.productId,
            locationId: q.locationId,
            quantity: { gte: l.quantity },
          },
          data: { quantity: { decrement: l.quantity } },
        });
        assert(
          changed.count === 1,
          409,
          'OUT_OF_STOCK',
          `${l.name} just sold out. Your order was not placed.`,
        );
      }
      const order = await tx.order.create({
        data: {
          number: `RP-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`,
          userId: actor.id,
          locationId: q.locationId,
          fulfillment: input.fulfillment,
          address: q.address,
          subtotal: q.subtotal,
          deliveryCharge: q.deliveryCharge,
          total: q.total,
          idempotencyKey: key,
          requestHash,
          items: { create: q.lines },
        },
        include: { items: true, location: true },
      });
      await tx.cartItem.deleteMany({ where: { userId: actor.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'ORDER_PLACED',
          resourceId: order.id,
          details: { total: q.total, simulatedPayment: true },
        },
      });
      return order;
    },
    { timeout: 20000 },
  );
  console.log('in terminal');
  return result;
}

export async function listOrders(actor: Actor) {
  return await db.order.findMany({
    where:
      actor.role === 'CUSTOMER'
        ? { userId: actor.id }
        : actor.role === 'STORE_MANAGER'
          ? { locationId: { in: actor.storeIds } }
          : {},
    include: { items: true, location: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function updateOrderStatus(actor: Actor, inputBody: unknown, id: string) {
  const { status } = z
    .object({
      status: z.enum([
        'READY_FOR_PICKUP',
        'COLLECTED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
      ]),
    })
    .parse(inputBody);
  await db.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: String(id) }, include: { items: true } });
    assert(o, 404, 'NOT_FOUND', 'Order not found.');
    if (actor.role === 'CUSTOMER')
      assert(
        o.userId === actor.id && status === 'CANCELLED',
        403,
        'FORBIDDEN',
        'This order action is not permitted.',
      );
    else storeAccess(actor, o.locationId);
    assert(
      canTransition(o.status, status, o.fulfillment),
      409,
      'INVALID_TRANSITION',
      'The order cannot move to this status.',
    );
    const changed = await tx.order.updateMany({
      where: { id: o.id, status: o.status },
      data: { status },
    });
    assert(changed.count === 1, 409, 'CONFLICT', 'Order was updated. Refresh and try again.');
    if (status === 'CANCELLED')
      for (const l of o.items)
        await tx.inventory.update({
          where: { productId_locationId: { productId: l.productId, locationId: o.locationId } },
          data: { quantity: { increment: l.quantity } },
        });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'ORDER_STATUS',
        resourceId: o.id,
        details: { from: o.status, to: status },
      },
    });
  });
  return { ok: true };
}
