import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/config/database.js';
test(
  'Catalogue controls, JWT permissions, checkout retries and policy evidence',
  { skip: process.env.RUN_DB_TESTS !== 'true', timeout: 120000 },
  async () => {
    // This test only removes its own customer, orders and audit records; seeded catalogue data is preserved.
    let userId = '';
    let token = '';
    let orderId = '';
    const auth = () => ({ Authorization: `Bearer ${token}` });
    try {
      const a = await request(app).get(
        '/api/v1/products?limit=4&page=1&sort=price-asc&storeId=store-bengaluru',
      );
      const b = await request(app).get(
        '/api/v1/products?limit=4&page=2&sort=price-asc&storeId=store-bengaluru',
      );
      assert.equal(a.status, 200);
      assert.equal(a.body.items.length, 4);
      assert.equal(a.body.limit, 4);
      assert(
        a.body.items.every(
          (p: { id: string }) => !b.body.items.some((x: { id: string }) => x.id === p.id),
        ),
      );
      const prices = [...a.body.items, ...b.body.items].map((p) => Number(p.price));
      assert.deepEqual(
        prices,
        [...prices].sort((x, y) => x - y),
      );
      assert.equal((await request(app).get('/api/v1/products?page=0')).status, 400);
      assert.equal((await request(app).get('/api/v1/products?limit=500')).status, 400);
      assert.equal((await request(app).get('/api/v1/products?sort=unsafe')).status, 400);
      const bengaluru = await request(app)
        .get('/api/v1/products?storeId=store-bengaluru&limit=50')
        .expect(200);
      const mumbai = await request(app)
        .get('/api/v1/products?storeId=store-mumbai&limit=50')
        .expect(200);
      assert(bengaluru.body.items.some((p: { name: string }) => p.name === 'Creator 15 laptop'));
      assert(!mumbai.body.items.some((p: { name: string }) => p.name === 'Creator 15 laptop'));
      assert(mumbai.body.items.some((p: { name: string }) => p.name === 'Compact 5G smartphone'));
      assert(
        !bengaluru.body.items.some((p: { name: string }) => p.name === 'Compact 5G smartphone'),
      );
      const specifications = await request(app)
        .get('/api/v1/products')
        .query({
          storeId: 'store-bengaluru',
          category: 'Computers',
          attributes: JSON.stringify({ RAM: '16 GB' }),
          minRating: 4,
        })
        .expect(200);
      assert(specifications.body.items.length > 0);
      assert(
        specifications.body.items.every(
          (p: { specifications: { attributes: { RAM: string } } }) =>
            p.specifications.attributes.RAM === '16 GB',
        ),
      );
      assert(specifications.body.attributeOptions.RAM.includes('32 GB'));
      await request(app).get('/api/v1/products').query({ attributes: 'not-json' }).expect(400);
      const filtered = await request(app).get(
        '/api/v1/products?category=Audio&brand=Sonic&inStock=true&storeId=store-bengaluru&maxPrice=3000',
      );
      assert(filtered.body.items.length > 0);
      assert(
        filtered.body.items.every(
          (p: { category: string; brand: string; price: string; availability: number }) =>
            p.category === 'Audio' &&
            p.brand === 'Sonic' &&
            Number(p.price) <= 3000 &&
            p.availability > 0,
        ),
      );
      assert.equal((await request(app).get('/api/v1/orders')).status, 401);
      const registration = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `test-${randomUUID()}@example.com`,
          name: 'Integration Customer',
          password: randomUUID() + randomUUID(),
        });
      assert.equal(registration.status, 201);
      token = registration.body.accessToken;
      userId = registration.body.user.id;
      assert.equal(registration.body.user.role, 'CUSTOMER');
      assert.equal(registration.body.user.passwordHash, undefined);
      assert.equal(
        (await request(app).get('/api/v1/operations/inventory').set(auth())).status,
        403,
      );
      const product = filtered.body.items[0];
      await request(app)
        .put(`/api/v1/cart/${product.id}`)
        .set(auth())
        .send({ quantity: 1 })
        .expect(200);
      const stockBefore = await db.inventory.findUniqueOrThrow({
        where: { productId_locationId: { productId: product.id, locationId: 'store-bengaluru' } },
      });
      const q = await request(app)
        .post('/api/v1/checkout/quote')
        .set(auth())
        .send({ storeId: 'store-bengaluru', fulfillment: 'PICKUP' })
        .expect(200);
      const key = randomUUID();
      const payload = {
        storeId: 'store-bengaluru',
        fulfillment: 'PICKUP',
        quoteHash: q.body.quoteHash,
      };
      const first = await request(app)
        .post('/api/v1/checkout')
        .set({ ...auth(), 'idempotency-key': key })
        .send(payload)
        .expect(201);
      orderId = first.body.id;
      const retry = await request(app)
        .post('/api/v1/checkout')
        .set({ ...auth(), 'idempotency-key': key })
        .send(payload)
        .expect(201);
      assert.equal(first.body.id, retry.body.id);
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: stockBefore.id } })).quantity,
        stockBefore.quantity - 1,
      );
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set(auth())
        .send({ status: 'CANCELLED' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set(auth())
        .send({ status: 'CANCELLED' })
        .expect(409);
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { id: stockBefore.id } })).quantity,
        stockBefore.quantity,
      );
      const ticket = await request(app)
        .post('/api/v1/support/tickets')
        .set(auth())
        .send({
          subject: 'Order support test',
          description: 'Please check this test order.',
          orderId,
        })
        .expect(201);
      assert.equal(ticket.body.location.id, 'store-bengaluru');
      assert.equal(ticket.body.order.id, orderId);
      await request(app)
        .post('/api/v1/support/tickets')
        .set(auth())
        .send({
          subject: 'Invalid route',
          description: 'Must not route to a different store.',
          orderId,
          locationId: 'store-mumbai',
        })
        .expect(400);
      await request(app)
        .post('/api/v1/support/tickets')
        .set(auth())
        .send({
          subject: 'Other order',
          description: 'Must not expose another customer order.',
          orderId: randomUUID(),
        })
        .expect(404);
      const evidence = await request(app)
        .post('/api/v1/assistant/ask')
        .set(auth())
        .send({
          question: 'Do Gold members receive free express delivery?',
          documentType: 'POLICY',
        })
        .expect(200);
      assert(evidence.body.sources.length > 0);
      assert(
        evidence.body.sources.every(
          (s: { document: string; version: string; section: string }) =>
            s.document && s.version && s.section,
        ),
      );
      const noEvidence = await request(app)
        .post('/api/v1/assistant/ask')
        .set(auth())
        .send({ question: 'zzzzqqqq nonexistentpolicy' })
        .expect(200);
      assert.equal(noEvidence.body.followUpRequired, true);
      assert.equal(noEvidence.body.sources.length, 0);
    } finally {
      if (userId) {
        // A cancelled test order has already restored stock. If checkout succeeded before an assertion failed, restore it here.
        if (orderId) {
          const order = await db.order.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (order && order.status !== 'CANCELLED')
            for (const i of order.items)
              await db.inventory.update({
                where: {
                  productId_locationId: { productId: i.productId, locationId: order.locationId },
                },
                data: { quantity: { increment: i.quantity } },
              });
        }
        await db.orderItem.deleteMany({ where: { order: { userId } } });
        await db.order.deleteMany({ where: { userId } });
        await db.supportTicket.deleteMany({ where: { userId } });
        await db.auditLog.deleteMany({ where: { actorId: userId } });
        await db.user.delete({ where: { id: userId } });
      }
      await db.$disconnect();
    }
  },
);
