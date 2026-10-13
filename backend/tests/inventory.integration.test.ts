import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/config/database.js';

test(
  'Assigned managers replenish stock once and cannot duplicate pending requests',
  { skip: process.env.RUN_DB_TESTS !== 'true', timeout: 120000 },
  async () => {
    let productId = '';
    const proposalIds: string[] = [];
    const sessions: string[] = [];
    try {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'manager@retailpulse.demo', password: process.env.DEMO_PASSWORD })
        .expect(200);
      const manager = { Authorization: `Bearer ${login.body.accessToken}` };
      sessions.push(
        JSON.parse(Buffer.from(login.body.accessToken.split('.')[1], 'base64url').toString()).sid,
      );
      const product = await db.product.create({
        data: {
          sku: `TEST-${randomUUID()}`,
          name: 'Test-only restock item',
          category: 'TEST',
          brand: 'TEST',
          description: 'Temporary inventory test',
          price: 100,
          rating: 4,
          specifications: {},
        },
      });
      productId = product.id;
      await db.inventory.createMany({
        data: ['store-bengaluru', 'store-mumbai'].map((locationId) => ({
          productId,
          locationId,
          quantity: 2,
          reorderPoint: 5,
          targetStock: 10,
        })),
      });
      const payload = {
        productId,
        locationId: 'store-bengaluru',
        quantity: 4,
        reason: 'Test-only stock replenishment',
      };
      await request(app)
        .post('/api/v1/operations/replenishment')
        .set(manager)
        .send({ ...payload, locationId: 'store-mumbai' })
        .expect(403);
      await request(app)
        .post('/api/v1/operations/replenishment')
        .set(manager)
        .send({ ...payload, quantity: -1 })
        .expect(400);
      const proposal = await request(app)
        .post('/api/v1/operations/replenishment')
        .set(manager)
        .send(payload)
        .expect(201);
      proposalIds.push(proposal.body.id);
      await request(app)
        .post('/api/v1/operations/replenishment')
        .set(manager)
        .send(payload)
        .expect(409);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${proposal.body.id}`)
        .set(manager)
        .send({ action: 'receive' })
        .expect(409);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${proposal.body.id}`)
        .set(manager)
        .send({ action: 'approve' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${proposal.body.id}`)
        .set(manager)
        .send({ action: 'receive' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${proposal.body.id}`)
        .set(manager)
        .send({ action: 'receive' })
        .expect(409);
      assert.equal(
        (
          await db.inventory.findUniqueOrThrow({
            where: { productId_locationId: { productId, locationId: 'store-bengaluru' } },
          })
        ).quantity,
        6,
      );
      const rejected = await request(app)
        .post('/api/v1/operations/replenishment')
        .set(manager)
        .send(payload)
        .expect(201);
      proposalIds.push(rejected.body.id);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${rejected.body.id}`)
        .set(manager)
        .send({ action: 'reject' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/operations/replenishment/${rejected.body.id}`)
        .set(manager)
        .send({ action: 'receive' })
        .expect(409);
    } finally {
      await db.auditLog.deleteMany({ where: { resourceId: { in: proposalIds } } });
      if (productId) {
        await db.replenishment.deleteMany({ where: { productId } });
        await db.inventory.deleteMany({ where: { productId } });
        await db.product.delete({ where: { id: productId } });
      }
      await db.authSession.deleteMany({ where: { id: { in: sessions } } });
      await db.$disconnect();
    }
  },
);
