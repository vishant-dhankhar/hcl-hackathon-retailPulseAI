import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/config/database.js';
import { chat } from '../src/services/chat.service.js';
import { prepareChatAction, confirmChatAction } from '../src/services/chat-actions.service.js';
import type { Actor } from '../src/middleware/authorize.js';
import { HttpError } from '../src/errors/HttpError.js';

test(
  'Unified chat enforces role scope, conversational search and reviewed actions',
  {
    skip: process.env.RUN_DB_TESTS !== 'true',
    timeout: 180000,
  },
  async (t) => {
    const suffix = randomUUID();
    const user = await db.user.create({
      data: {
        email: `chat-${suffix}@example.com`,
        name: 'Chat test',
        passwordHash: 'no-login-test-fixture',
      },
    });
    const product = await db.product.create({
      data: {
        sku: `CHAT-${suffix}`,
        name: `Chat ${suffix} laptop`,
        category: 'Computers',
        brand: 'ChatTest',
        description: 'Laptop with 32 GB RAM',
        price: 75000,
        rating: 4,
        specifications: { RAM: '32 GB RAM' },
      },
    });
    const actor: Actor = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'CUSTOMER',
      tier: 'STANDARD',
      storeIds: [],
      sessionId: 'chat-test-session',
    };
    const manager: Actor = { ...actor, role: 'STORE_MANAGER', storeIds: ['store-bengaluru'] };
    const admin: Actor = { ...actor, role: 'ADMIN' };
    const priorKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'local-mocked-provider';
    let routed: Record<string, unknown> = { intent: 'LOW_STOCK' };
    let sawHistory = false;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      const system: string = payload.messages[0].content;
      const input = JSON.parse(payload.messages[1].content);
      let output: unknown = routed;
      if (system.startsWith('Extract retail requirements')) {
        sawHistory = input.history[0]?.content.includes('32 GB RAM');
        output = {
          interpretedRequirement: '32 GB RAM laptop under 80000',
          category: 'Computers',
          brand: 'ChatTest',
          productKind: 'laptop',
          maxPrice: 80000,
          requiredSpecifications: ['32 GB RAM'],
          clarifyingQuestion: null,
        };
      } else if (system.startsWith('Return JSON {interpretedRequirement')) {
        output = {
          interpretedRequirement: '32 GB RAM laptop under 80000',
          recommendations: [{ productId: product.id, reason: 'Matches RAM and budget.' }],
          clarifyingQuestion: 'What will you use it for?',
        };
      }
      return Response.json({
        choices: [
          {
            message: payload.tools
              ? {
                  tool_calls: [
                    { function: { name: 'search_products', arguments: JSON.stringify(output) } },
                  ],
                }
              : { content: JSON.stringify(output) },
          },
        ],
      });
    });
    const query = (
      who: Actor,
      question = 'Show records',
      history: { role: 'user' | 'assistant'; content: string }[] = [],
    ) => chat(who, { question, storeId: 'store-bengaluru', history });
    const denied = (fn: () => Promise<unknown>) =>
      assert.rejects(fn, (e) => e instanceof HttpError && e.status === 403);
    try {
      await db.inventory.createMany({
        data: ['store-bengaluru', 'store-mumbai'].map((locationId) => ({
          productId: product.id,
          locationId,
          quantity: 2,
          reorderPoint: 5,
          targetStock: 10,
        })),
      });
      const inventory = await db.inventory.findFirstOrThrow({
        where: { productId: product.id, locationId: 'store-bengaluru' },
      });
      const outside = await db.inventory.findFirstOrThrow({
        where: { productId: product.id, locationId: 'store-mumbai' },
      });
      const ticket = await db.supportTicket.create({
        data: {
          userId: user.id,
          locationId: 'store-bengaluru',
          subject: `Chat ticket ${suffix}`,
          description: 'Please check this test-only issue.',
          priority: 'NORMAL',
        },
      });
      await db.order.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          userId: user.id,
          locationId: 'store-bengaluru',
          number: `CHAT-${suffix}-${i}`,
          fulfillment: 'PICKUP',
          subtotal: 10,
          total: 10,
          deliveryCharge: 0,
          idempotencyKey: `${suffix}-${i}`,
          requestHash: 'test',
        })),
      });
      routed = { intent: 'LOW_STOCK', search: suffix };
      await denied(() => query(actor));
      const stock = await query(manager);
      assert.equal(stock.records?.length, 1);
      assert(stock.records?.[0].detail.includes('Indiranagar'));
      routed = { intent: 'INVENTORY', locationId: 'store-mumbai' };
      await denied(() => query(manager));
      routed = { intent: 'ORDER_SUMMARY' };
      const orders = await query(actor);
      assert(orders.answer.startsWith('101 matching records'));
      assert.equal(orders.records?.length, 10);
      routed = { intent: 'ORDERS', page: 11 };
      assert.equal((await query(actor)).records?.length, 1);
      routed = { intent: 'PRODUCTS' };
      const products = await query(manager, 'Under 80000', [
        { role: 'user', content: 'Find a laptop with 32 GB RAM' },
      ]);
      assert(sawHistory);
      assert.equal(products.products?.[0].productId, product.id);
      const cartReview = await prepareChatAction(actor, {
        kind: 'ADD_CART',
        targetId: product.id,
        storeId: 'store-bengaluru',
        quantity: 1,
      });
      assert.equal(await db.cartItem.count({ where: { userId: user.id } }), 0);
      await confirmChatAction(actor, { token: cartReview.token });
      await confirmChatAction(actor, { token: cartReview.token });
      assert.equal(
        (await db.cartItem.findFirstOrThrow({ where: { userId: user.id } })).quantity,
        1,
      );
      routed = { intent: 'CHECKOUT' };
      assert.equal((await query(actor)).navigation?.[0].panel, 'cart');
      routed = { intent: 'CHECKOUT', targetId: product.id, quantity: 1, period: null, page: null };
      assert.equal((await query(actor)).records?.[0].actions[0].kind, 'ADD_CART');
      routed = { intent: 'ACCOUNTS' };
      await denied(() => query(manager));
      assert.equal((await query(admin)).navigation?.[0].panel, 'admin');
      routed = { intent: 'TICKETS', targetId: ticket.id };
      assert.equal((await query(actor)).records?.[0].actions.length, 0);
      assert((await query(manager)).records?.[0].actions.some((a) => a.kind === 'TICKET_REPLY'));
      await denied(() =>
        prepareChatAction(actor, { kind: 'TICKET_REPLY', targetId: ticket.id, body: 'Test reply' }),
      );
      await denied(() =>
        prepareChatAction(manager, {
          kind: 'RESTOCK',
          targetId: outside.id,
          quantity: 4,
          reason: 'Test replenishment',
        }),
      );
      const reply = await prepareChatAction(manager, {
        kind: 'TICKET_REPLY',
        targetId: ticket.id,
        body: 'The manager is checking your issue.',
      });
      assert.equal(
        await db.ticketReply.count({ where: { ticketId: ticket.id } }),
        0,
        'Review must not execute',
      );
      await assert.rejects(() =>
        confirmChatAction({ ...manager, sessionId: 'another-session' }, { token: reply.token }),
      );
      await assert.rejects(() =>
        confirmChatAction(manager, { token: reply.token.slice(0, -5) + 'abcde' }),
      );
      await confirmChatAction(manager, { token: reply.token });
      await confirmChatAction(manager, { token: reply.token });
      assert.equal(
        await db.ticketReply.count({ where: { ticketId: ticket.id } }),
        1,
        'Reply retries are idempotent',
      );
      const escalate = await prepareChatAction(manager, {
        kind: 'TICKET_ESCALATE',
        targetId: ticket.id,
      });
      await confirmChatAction(manager, { token: escalate.token });
      const resolve = await prepareChatAction(admin, {
        kind: 'TICKET_RESOLVE',
        targetId: ticket.id,
      });
      await confirmChatAction(admin, { token: resolve.token });
      assert.equal(
        (await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status,
        'RESOLVED',
      );
      assert(
        (await query(actor)).records?.[0].detail.includes('The manager is checking your issue.'),
      );
      // Exact counts can reduce to zero or increase stock; only confirmation writes and audits.
      const adjustment = {
        kind: 'SET_STOCK',
        targetId: inventory.id,
        quantity: 0,
        reason: 'Physical count correction',
      };
      await denied(() => prepareChatAction(actor, adjustment));
      await denied(() => prepareChatAction({ ...manager, storeIds: ['store-mumbai'] }, adjustment));
      for (const quantity of [-1, 1.5, 1000001])
        await assert.rejects(() => prepareChatAction(manager, { ...adjustment, quantity }));
      await assert.rejects(() => prepareChatAction(manager, { ...adjustment, reason: '' }));
      const zero = await prepareChatAction(manager, adjustment);
      assert(zero.summary?.includes('from 2 to 0'));
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        2,
      );
      await denied(() =>
        confirmChatAction({ ...manager, storeIds: ['store-mumbai'] }, { token: zero.token }),
      );
      await confirmChatAction(manager, { token: zero.token });
      await confirmChatAction(manager, { token: zero.token });
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        0,
      );
      assert.equal(
        await db.auditLog.count({
          where: { resourceId: inventory.id, action: 'STOCK_QUANTITY_SET' },
        }),
        1,
      );
      await db.inventory.update({ where: { id: inventory.id }, data: { quantity: 1 } });
      await confirmChatAction(manager, { token: zero.token });
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        1,
        'Retry must not overwrite a later stock change',
      );
      const increase = await prepareChatAction(admin, { ...adjustment, quantity: 7 });
      await confirmChatAction(admin, { token: increase.token });
      const reset = await prepareChatAction(manager, { ...adjustment, quantity: 2 });
      await confirmChatAction(manager, { token: reset.token });
      const stale = await prepareChatAction(manager, { ...adjustment, quantity: 8 });
      await db.inventory.update({ where: { id: inventory.id }, data: { quantity: 3 } });
      await assert.rejects(
        () => confirmChatAction(manager, { token: stale.token }),
        (e) => e instanceof HttpError && e.code === 'STOCK_CHANGED',
      );
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        3,
      );
      await db.inventory.update({ where: { id: inventory.id }, data: { quantity: 2 } });
      routed = {
        intent: 'SET_STOCK',
        targetId: inventory.id,
        quantity: 0,
        reason: 'Physical count correction',
      };
      const stockChat = await query(manager, 'Set this stock to zero');
      assert.equal(stockChat.records?.[0].actions.find((a) => a.kind === 'SET_STOCK')?.quantity, 0);
      assert(!stockChat.records?.[0].actions.some((a) => a.kind === 'RESTOCK'));
      const restock = await prepareChatAction(manager, {
        kind: 'RESTOCK',
        targetId: inventory.id,
        quantity: 4,
        reason: 'Chat test replenishment',
      });
      const competing = await prepareChatAction(admin, {
        kind: 'RESTOCK',
        targetId: inventory.id,
        quantity: 9,
        reason: 'Concurrent replenishment review',
      });
      const created = await confirmChatAction(manager, { token: restock.token });
      assert(created.records?.[0].actions.some((a) => a.kind === 'APPROVE_STOCK'));
      await confirmChatAction(manager, { token: restock.token });
      assert.equal(await db.replenishment.count({ where: { productId: product.id } }), 1);
      const proposal = await db.replenishment.findFirstOrThrow({
        where: { productId: product.id },
      });
      const duplicate = await prepareChatAction(manager, {
        kind: 'RESTOCK',
        targetId: inventory.id,
        quantity: 50,
        reason: 'Should reuse original',
      });
      assert.equal(duplicate.existingRequest, true);
      assert.equal(duplicate.records?.[0].id, proposal.id);
      assert(duplicate.records?.[0].detail.includes('4 units'));
      assert.equal(
        duplicate.token,
        undefined,
        'A duplicate request must not issue a create approval',
      );
      const raced = await confirmChatAction(admin, { token: competing.token });
      assert.equal(raced.existingRequest, true);
      assert.equal(raced.records?.[0].id, proposal.id);
      assert.equal(await db.replenishment.count({ where: { productId: product.id } }), 1);
      await denied(() =>
        prepareChatAction(actor, {
          kind: 'RESTOCK',
          targetId: inventory.id,
          quantity: 4,
          reason: 'Customer denied',
        }),
      );
      await denied(() =>
        prepareChatAction(
          { ...manager, storeIds: ['store-mumbai'] },
          { kind: 'RESTOCK', targetId: inventory.id, quantity: 4, reason: 'Other store denied' },
        ),
      );
      routed = { intent: 'LOW_STOCK', targetId: inventory.id };
      const pendingStock = await query(manager);
      assert(
        !pendingStock.records
          ?.find((r) => r.id === inventory.id)
          ?.actions.some((a) => a.kind === 'RESTOCK'),
      );
      assert(
        pendingStock.records
          ?.find((r) => r.id === proposal.id)
          ?.actions.some((a) => a.kind === 'APPROVE_STOCK'),
      );
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        2,
      );
      const approve = await prepareChatAction(manager, {
        kind: 'APPROVE_STOCK',
        targetId: proposal.id,
      });
      const approved = await confirmChatAction(manager, { token: approve.token });
      assert(approved.records?.[0].actions.some((a) => a.kind === 'RECEIVE_STOCK'));
      const approvedDuplicate = await prepareChatAction(admin, {
        kind: 'RESTOCK',
        targetId: inventory.id,
        quantity: 7,
        reason: 'Already approved request',
      });
      assert.equal(approvedDuplicate.records?.[0].id, proposal.id);
      assert.deepEqual(
        approvedDuplicate.records?.[0].actions.map((a) => a.kind),
        ['RECEIVE_STOCK'],
      );
      const receive = await prepareChatAction(manager, {
        kind: 'RECEIVE_STOCK',
        targetId: proposal.id,
      });
      await confirmChatAction(manager, { token: receive.token });
      await assert.rejects(() => confirmChatAction(manager, { token: receive.token }));
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        6,
      );
      const order = await db.order.findFirstOrThrow({ where: { userId: user.id } });
      await db.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          name: product.name,
          quantity: 1,
          unitPrice: 10,
        },
      });
      const cancellation = await prepareChatAction(actor, {
        kind: 'CANCEL_ORDER',
        targetId: order.id,
      });
      await confirmChatAction(actor, { token: cancellation.token });
      await assert.rejects(() => confirmChatAction(actor, { token: cancellation.token }));
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).quantity,
        7,
      );
      await assert.rejects(() =>
        query(
          actor,
          'Hi',
          Array.from({ length: 9 }, () => ({ role: 'user' as const, content: 'Hello' })),
        ),
      );
    } finally {
      t.mock.restoreAll();
      if (priorKey === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = priorKey;
      await db.supportTicket.deleteMany({ where: { userId: user.id } });
      await db.order.deleteMany({ where: { userId: user.id } });
      await db.replenishment.deleteMany({ where: { productId: product.id } });
      await db.inventory.deleteMany({ where: { productId: product.id } });
      await db.cartItem.deleteMany({ where: { userId: user.id } });
      await db.product.delete({ where: { id: product.id } });
      await db.auditLog.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
