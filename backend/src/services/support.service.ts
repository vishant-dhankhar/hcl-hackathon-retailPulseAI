import { z } from 'zod';
import { db } from '../config/database.js';
import { assert } from '../errors/HttpError.js';
import { storeAccess, type Actor } from '../middleware/authorize.js';
import type { Prisma } from '../generated/prisma/client.js';

const include = {
  replies: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { author: { select: { name: true } } },
  },
  order: { select: { id: true, number: true, fulfillment: true } },
  location: { select: { id: true, name: true, city: true } },
  user: { select: { name: true } },
};

export async function listTickets(actor: Actor, query: Record<string, unknown> = {}) {
  const { status } = z
    .object({
      status: z
        .enum(['ALL', 'ACTIVE', 'OPEN', 'ESCALATED', 'RESOLVED'])
        .default(actor.role === 'CUSTOMER' ? 'ALL' : 'ACTIVE'),
    })
    .parse(query);
  const where: Prisma.SupportTicketWhereInput = {
    ...(actor.role === 'CUSTOMER'
      ? { userId: actor.id }
      : actor.role === 'STORE_MANAGER'
        ? { locationId: { in: actor.storeIds } }
        : {}),
    ...(status === 'ACTIVE' ? { status: { not: 'RESOLVED' } } : status !== 'ALL' ? { status } : {}),
  };
  // Fetch each tier independently so recent normal tickets cannot crowd urgent tickets out of the queue.
  if (actor.role !== 'CUSTOMER') {
    const queues = await Promise.all(
      ['URGENT', 'HIGH', 'NORMAL'].map((priority) =>
        db.supportTicket.findMany({
          where: { ...where, priority },
          include,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        }),
      ),
    );
    return queues.flat().slice(0, 100);
  }
  return db.supportTicket.findMany({
    where,
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 100,
  });
}

function staffAccess(actor: Actor, ticket: { locationId: string | null }) {
  assert(
    actor.role === 'ADMIN' || actor.role === 'STORE_MANAGER',
    403,
    'FORBIDDEN',
    'Only staff can answer tickets.',
  );
  if (ticket.locationId) storeAccess(actor, ticket.locationId);
  else
    assert(
      actor.role === 'ADMIN',
      403,
      'FORBIDDEN',
      'Only administrators handle unassigned tickets.',
    );
}

export async function createTicket(actor: Actor, inputBody: unknown) {
  const input = z
    .object({
      subject: z.string().trim().min(3).max(120),
      description: z.string().trim().min(10).max(3000),
      locationId: z.string().min(1).optional(),
      orderId: z.string().min(1).optional(),
    })
    .strict()
    .parse(inputBody);
  let locationId = input.locationId;
  if (input.orderId) {
    // Ownership and routing are derived on the server; customers cannot route another person's order.
    const order = await db.order.findFirst({ where: { id: input.orderId, userId: actor.id } });
    assert(order, 404, 'NOT_FOUND', 'Order not found. Select one of your own orders.');
    assert(
      !locationId || locationId === order.locationId,
      400,
      'ORDER_LOCATION_MISMATCH',
      'The ticket must use the order fulfillment location.',
    );
    locationId = order.locationId;
  } else if (locationId)
    assert(
      await db.location.findUnique({ where: { id: locationId, warehouse: false } }),
      400,
      'INVALID_STORE',
      'Invalid store.',
    );
  return db.supportTicket.create({
    data: {
      ...input,
      locationId,
      userId: actor.id,
      priority: actor.tier === 'PLATINUM' ? 'URGENT' : actor.tier === 'GOLD' ? 'HIGH' : 'NORMAL',
    },
    include,
  });
}

export async function replyToTicket(actor: Actor, id: string, input: unknown, approvalId?: string) {
  const { body } = z
    .object({ body: z.string().trim().min(3).max(3000) })
    .strict()
    .parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id})::bigint)`;
    // A confirmed chat approval can be retried after a lost connection without sending twice.
    if (approvalId && (await tx.auditLog.findUnique({ where: { id: approvalId } })))
      return { ok: true };
    const ticket = await tx.supportTicket.findUnique({ where: { id } });
    assert(ticket, 404, 'NOT_FOUND', 'Ticket not found.');
    staffAccess(actor, ticket);
    assert(ticket.status !== 'RESOLVED', 409, 'TICKET_CLOSED', 'This ticket is resolved.');
    const reply = await tx.ticketReply.create({
      data: { ticketId: id, authorId: actor.id, authorRole: actor.role, body },
    });
    await tx.auditLog.create({
      data: {
        ...(approvalId ? { id: approvalId } : {}),
        actorId: actor.id,
        action: 'TICKET_REPLIED',
        resourceId: id,
        details: { replyId: reply.id },
      },
    });
    return { ok: true };
  });
}

export async function updateTicket(actor: Actor, id: string, input: unknown) {
  const { status } = z
    .object({ status: z.enum(['ESCALATED', 'RESOLVED']) })
    .strict()
    .parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id})::bigint)`;
    const ticket = await tx.supportTicket.findUnique({ where: { id } });
    assert(ticket, 404, 'NOT_FOUND', 'Ticket not found.');
    staffAccess(actor, ticket);
    assert(
      status !== 'ESCALATED' || actor.role === 'STORE_MANAGER',
      403,
      'FORBIDDEN',
      'Administrators resolve escalated tickets.',
    );
    assert(
      ticket.status === 'OPEN' || (ticket.status === 'ESCALATED' && status === 'RESOLVED'),
      409,
      'INVALID_TRANSITION',
      'This ticket cannot move to that status.',
    );
    if (status === 'RESOLVED')
      assert(
        await tx.ticketReply.count({ where: { ticketId: id } }),
        400,
        'ANSWER_REQUIRED',
        'Send the customer an answer before resolving this ticket.',
      );
    const changed = await tx.supportTicket.updateMany({
      where: { id, status: ticket.status },
      data: { status },
    });
    assert(changed.count === 1, 409, 'CONFLICT', 'Ticket changed. Refresh and try again.');
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: `TICKET_${status}`,
        resourceId: id,
        details: { previousStatus: ticket.status },
      },
    });
    return { ok: true };
  });
}
