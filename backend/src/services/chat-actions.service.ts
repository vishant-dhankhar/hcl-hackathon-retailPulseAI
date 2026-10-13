import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../config/database.js';
import { assert, HttpError } from '../errors/HttpError.js';
import { storeAccess, type Actor } from '../middleware/authorize.js';
import { replyToTicket, updateTicket } from './support.service.js';
import {
  createReplenishment,
  updateReplenishment,
  setStockQuantity,
} from './operations.service.js';
import { updateOrderStatus, updateCart } from './shopping.service.js';
import {
  existingReplenishment,
  pendingReplenishment,
  replenishmentCard,
} from './chat-replenishment.service.js';

export const actionInput = z
  .object({
    kind: z.enum([
      'CANCEL_ORDER',
      'ADD_CART',
      'TICKET_REPLY',
      'TICKET_RESOLVE',
      'TICKET_ESCALATE',
      'RESTOCK',
      'SET_STOCK',
      'APPROVE_STOCK',
      'RECEIVE_STOCK',
      'REJECT_STOCK',
    ]),
    targetId: z.string().min(1).max(100),
    body: z.string().trim().max(3000).optional(),
    quantity: z.number().int().min(0).max(1000000).optional(),
    stockVersion: z.string().datetime().optional(),
    reason: z.string().trim().max(500).optional(),
    storeId: z.string().min(1).max(100).optional(),
  })
  .strict();
export type ChatAction = z.infer<typeof actionInput> & { label: string };

// Only this server-owned allowlist can produce executable approvals. Model text never executes writes.
export async function prepareChatAction(actor: Actor, raw: unknown) {
  const input = actionInput.parse(raw);
  assert(
    actor.role !== 'CUSTOMER' || ['CANCEL_ORDER', 'ADD_CART'].includes(input.kind),
    403,
    'FORBIDDEN',
    'Only authorized staff can handle tickets or inventory.',
  );
  let summary: string;
  if (input.kind === 'ADD_CART') {
    assert(
      actor.role === 'CUSTOMER',
      403,
      'FORBIDDEN',
      'Only customers can add products to a cart.',
    );
    assert(
      input.quantity && input.quantity <= 99 && input.storeId,
      400,
      'DETAILS_REQUIRED',
      'Select a store and 1–99 units.',
    );
    const item = await db.inventory.findFirst({
      where: {
        productId: input.targetId,
        locationId: input.storeId,
        product: { active: true },
        location: { warehouse: false },
        quantity: { gte: input.quantity },
      },
      include: { product: true, location: true },
    });
    assert(
      item,
      409,
      'OUT_OF_STOCK',
      'That quantity is no longer available at this store. Refresh recommendations.',
    );
    summary = `Set your cart quantity for ${item.product.name} to ${input.quantity} at ₹${item.product.price} each, using ${item.location.name}. Review delivery charges, address and payment at checkout. Adding to cart does not reserve stock.`;
  } else if (input.kind === 'CANCEL_ORDER') {
    const order = await db.order.findUnique({ where: { id: input.targetId } });
    assert(order, 404, 'NOT_FOUND', 'Order not found.');
    if (actor.role === 'CUSTOMER')
      assert(order.userId === actor.id, 403, 'FORBIDDEN', 'You can cancel only your own orders.');
    else storeAccess(actor, order.locationId);
    assert(
      order.status === 'PLACED',
      409,
      'INVALID_TRANSITION',
      'Only newly placed orders can be cancelled.',
    );
    summary = `Cancel order ${order.number}. Its reserved quantities will be returned to stock.`;
  } else if (input.kind.startsWith('TICKET_')) {
    const ticket = await db.supportTicket.findUnique({
      where: { id: input.targetId },
      include: { location: true, _count: { select: { replies: true } } },
    });
    assert(ticket, 404, 'NOT_FOUND', 'Ticket not found.');
    if (ticket.locationId) storeAccess(actor, ticket.locationId);
    else
      assert(
        actor.role === 'ADMIN',
        403,
        'FORBIDDEN',
        'Only administrators handle unassigned tickets.',
      );
    assert(ticket.status !== 'RESOLVED', 409, 'TICKET_CLOSED', 'This ticket is already resolved.');
    if (input.kind === 'TICKET_REPLY') {
      assert(
        (input.body?.length || 0) >= 3,
        400,
        'ANSWER_REQUIRED',
        'Write the customer reply before reviewing.',
      );
      summary = `Send this reply to “${ticket.subject}”: ${input.body}`;
    } else if (input.kind === 'TICKET_ESCALATE') {
      assert(
        actor.role === 'STORE_MANAGER' && ticket.status === 'OPEN',
        403,
        'FORBIDDEN',
        'Only managers can escalate an open ticket.',
      );
      summary = `Escalate “${ticket.subject}” to administrators.`;
    } else {
      assert(
        ticket._count.replies > 0,
        400,
        'ANSWER_REQUIRED',
        'Send a customer reply before resolving this ticket.',
      );
      summary = `Resolve “${ticket.subject}”. The customer will see the saved replies.`;
    }
  } else if (input.kind === 'SET_STOCK') {
    const item = await db.inventory.findUnique({
      where: { id: input.targetId },
      include: { product: true, location: true },
    });
    assert(item, 404, 'NOT_FOUND', 'Inventory record not found.');
    storeAccess(actor, item.locationId);
    assert(
      input.quantity !== undefined && (input.reason?.length || 0) >= 5,
      400,
      'DETAILS_REQUIRED',
      'Enter a whole-number quantity of 0–1,000,000 and a reason of at least 5 characters.',
    );
    // Replace any caller-supplied version with the current server snapshot before signing.
    input.stockVersion = item.updatedAt.toISOString();
    summary = `Set ${item.product.name} at ${item.location.name}, ${item.location.city} from ${item.quantity} to ${input.quantity} units (${input.quantity - item.quantity >= 0 ? '+' : ''}${input.quantity - item.quantity}). Reason: ${input.reason}. This replaces available stock immediately; pending replenishments stay separate.`;
  } else if (input.kind === 'RESTOCK') {
    const existing = await pendingReplenishment(actor, input.targetId);
    if (existing) return existingReplenishment(existing);
    const item = await db.inventory.findUnique({
      where: { id: input.targetId },
      include: { product: true, location: true },
    });
    assert(item, 404, 'NOT_FOUND', 'Inventory record not found.');
    storeAccess(actor, item.locationId);
    assert(
      input.quantity && input.quantity <= 1000 && (input.reason?.length || 0) >= 5,
      400,
      'DETAILS_REQUIRED',
      'Enter 1–1000 units and a reason of at least 5 characters.',
    );
    summary = `Request ${input.quantity} units of ${item.product.name} at ${item.location.name}. Current stock: ${item.quantity}. Reason: ${input.reason}. Stock increases only after approval and receipt.`;
  } else {
    const proposal = await db.replenishment.findUnique({
      where: { id: input.targetId },
      include: { product: true, location: true },
    });
    assert(proposal, 404, 'NOT_FOUND', 'Replenishment not found.');
    storeAccess(actor, proposal.locationId);
    assert(
      proposal.status === (input.kind === 'RECEIVE_STOCK' ? 'APPROVED' : 'PROPOSED'),
      409,
      'INVALID_TRANSITION',
      'This replenishment is not ready for that action.',
    );
    summary = `${input.kind === 'RECEIVE_STOCK' ? 'Receive and add to stock' : input.kind === 'APPROVE_STOCK' ? 'Approve' : 'Reject'} ${proposal.quantity} units of ${proposal.product.name} at ${proposal.location.name}.`;
  }
  // Short-lived approvals bind exact reviewed fields to the authenticated user and session.
  const token = jwt.sign({ input, sid: actor.sessionId }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: actor.id,
    jwtid: randomUUID(),
    expiresIn: '10m',
    issuer: 'retailpulse-chat',
    audience: 'retailpulse-chat-approval',
  });
  return { token, summary };
}

export async function confirmChatAction(actor: Actor, raw: unknown) {
  const { token } = z
    .object({ token: z.string().min(1).max(12000) })
    .strict()
    .parse(raw);
  let claims;
  try {
    claims = z
      .object({
        sub: z.literal(actor.id),
        sid: z.literal(actor.sessionId),
        jti: z.string().uuid(),
        input: actionInput,
      })
      .parse(
        jwt.verify(token, config.JWT_SECRET, {
          algorithms: ['HS256'],
          issuer: 'retailpulse-chat',
          audience: 'retailpulse-chat-approval',
        }),
      );
  } catch {
    throw new HttpError(
      400,
      'INVALID_APPROVAL',
      'This approval expired or is invalid. Review the action again.',
    );
  }
  const { input, jti } = claims;
  assert(
    actor.role !== 'CUSTOMER' || ['CANCEL_ORDER', 'ADD_CART'].includes(input.kind),
    403,
    'FORBIDDEN',
    'Only authorized staff can perform this action.',
  );
  // Domain services re-check current ownership, location assignment and state at execution time.
  if (input.kind === 'ADD_CART') {
    // Revalidate stock at confirmation; checkout independently revalidates price and availability again.
    await prepareChatAction(actor, input);
    await updateCart(actor, { quantity: input.quantity }, input.targetId);
    return {
      ok: true,
      message:
        'Cart updated. Continue to checkout to review your address, delivery charges and payment.',
      navigation: [{ panel: 'cart', label: 'Continue to address & payment' }],
      storeId: input.storeId,
    };
  } else if (input.kind === 'SET_STOCK') {
    await setStockQuantity(
      actor,
      input.targetId,
      { quantity: input.quantity, reason: input.reason, stockVersion: input.stockVersion },
      jti,
    );
    const item = await db.inventory.findUniqueOrThrow({
      where: { id: input.targetId },
      include: { product: true, location: true },
    });
    return {
      ok: true,
      message: `Stock quantity saved. ${item.product.name} at ${item.location.name} now has ${item.quantity} available units.`,
      records: [
        {
          id: item.id,
          title: item.product.name,
          detail: `${item.location.name}, ${item.location.city} · ${item.quantity} in stock`,
          actions: [
            {
              kind: 'SET_STOCK' as const,
              targetId: item.id,
              label: 'Set stock quantity',
              quantity: item.quantity,
            },
          ],
        },
      ],
    };
  } else if (input.kind === 'CANCEL_ORDER')
    await updateOrderStatus(actor, { status: 'CANCELLED' }, input.targetId);
  else if (input.kind === 'TICKET_REPLY')
    await replyToTicket(actor, input.targetId, { body: input.body }, jti);
  else if (input.kind === 'TICKET_RESOLVE' || input.kind === 'TICKET_ESCALATE')
    await updateTicket(actor, input.targetId, {
      status: input.kind === 'TICKET_RESOLVE' ? 'RESOLVED' : 'ESCALATED',
    });
  else if (input.kind === 'RESTOCK') {
    const item = await db.inventory.findUnique({ where: { id: input.targetId } });
    assert(item, 404, 'NOT_FOUND', 'Inventory record not found.');
    let proposal;
    try {
      proposal = await createReplenishment(
        actor,
        {
          productId: item.productId,
          locationId: item.locationId,
          quantity: input.quantity,
          reason: input.reason,
        },
        jti,
      );
    } catch (error) {
      // Another staff member can create a request after review; surface it instead of a dead end.
      if (!(error instanceof HttpError) || error.code !== 'ALREADY_PENDING') throw error;
      const existing = await pendingReplenishment(actor, input.targetId);
      if (!existing) throw error;
      return existingReplenishment(existing);
    }
    return {
      ok: true,
      message:
        'Replenishment requested. Review the saved request below to approve it. Stock changes only after receipt.',
      records: [
        replenishmentCard({
          ...proposal,
          product: await db.product.findUniqueOrThrow({ where: { id: proposal.productId } }),
          location: await db.location.findUniqueOrThrow({ where: { id: proposal.locationId } }),
        }),
      ],
    };
  } else
    await updateReplenishment(
      actor,
      {
        action:
          input.kind === 'APPROVE_STOCK'
            ? 'approve'
            : input.kind === 'RECEIVE_STOCK'
              ? 'receive'
              : 'reject',
      },
      input.targetId,
    );
  if (['APPROVE_STOCK', 'RECEIVE_STOCK', 'REJECT_STOCK'].includes(input.kind)) {
    const proposal = await db.replenishment.findUniqueOrThrow({
      where: { id: input.targetId },
      include: { product: true, location: true },
    });
    return {
      ok: true,
      message:
        proposal.status === 'APPROVED'
          ? 'Request approved. Stock stays unchanged until you confirm receipt.'
          : proposal.status === 'RECEIVED'
            ? 'Stock received and inventory updated.'
            : 'Request rejected.',
      records: [replenishmentCard(proposal)],
    };
  }
  return {
    ok: true,
    message: 'Action completed. Ask to show the latest tickets or stock to refresh the results.',
  };
}
