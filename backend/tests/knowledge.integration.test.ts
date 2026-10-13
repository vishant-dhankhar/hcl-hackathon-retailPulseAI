import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/config/database.js';
import { processOneDocument } from '../src/services/knowledge.service.js';
test(
  'Document ingestion, publication, tier evidence and assigned-store permissions',
  {
    skip: process.env.RUN_DB_TESTS !== 'true',
    timeout: 180000,
  },
  async () => {
    let userId = '';
    let documentId = '';
    let filePath = '';
    const staffSessions: string[] = [];
    const marker = randomUUID().replaceAll('-', '');
    try {
      const login = async (email: string) => {
        const r = await request(app)
          .post('/api/v1/auth/login')
          .send({ email, password: process.env.DEMO_PASSWORD })
          .expect(200);
        staffSessions.push(
          JSON.parse(Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString()).sid,
        );
        return { Authorization: `Bearer ${r.body.accessToken}` };
      };
      const admin = await login('admin@retailpulse.demo');
      const manager = await login('manager@retailpulse.demo');
      const mumbaiManager = await login('manager.mumbai@retailpulse.demo');
      await request(app)
        .get('/api/v1/operations/inventory?storeId=store-mumbai')
        .set(manager)
        .expect(403);
      const assigned = await request(app)
        .get('/api/v1/operations/inventory?storeId=store-bengaluru')
        .set(manager)
        .expect(200);
      assert(assigned.body.items.length > 0);
      assert(
        assigned.body.items.every(
          (i: { locationId: string }) => i.locationId === 'store-bengaluru',
        ),
      );
      const registration = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `policy-${marker}@example.com`,
          name: 'Policy Test',
          password: randomUUID() + randomUUID(),
        })
        .expect(201);
      userId = registration.body.user.id;
      const customer = { Authorization: `Bearer ${registration.body.accessToken}` };
      await request(app).post('/api/v1/knowledge/documents').set(customer).expect(403);
      // Managers can use approved policies but cannot publish or administer them.
      await request(app).post('/api/v1/knowledge/documents').set(manager).expect(403);
      await request(app).get('/api/v1/knowledge/documents').set(manager).expect(403);
      const upload = await request(app)
        .post('/api/v1/knowledge/documents')
        .set(admin)
        .field(
          'metadata',
          JSON.stringify({
            title: `Integration manual ${marker}`,
            version: 'test-1',
            country: 'IN',
            category: 'TEST',
            documentType: 'MANUAL',
            tiers: ['GOLD'],
            audience: ['CUSTOMER'],
            effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
          }),
        )
        .attach(
          'file',
          Buffer.from(
            `# Tier access\n\nDemo integration evidence: ${marker} tieraccess is available only to Gold members for this test.`,
          ),
          { filename: 'integration.md', contentType: 'text/markdown' },
        )
        .expect(202);
      documentId = upload.body.id;
      // Uploads survive a different serverless instance and never expose private bytes.
      assert.equal(upload.body.originalFile, undefined);
      assert.equal(upload.body.filePath, undefined);
      const storedUpload = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
      assert(storedUpload.originalFile && storedUpload.originalFile.byteLength > 20);
      assert.equal(storedUpload.filePath, null);
      await request(app)
        .patch(`/api/v1/knowledge/documents/${documentId}`)
        .set(manager)
        .send({ active: true })
        .expect(403);
      await request(app)
        .patch(`/api/v1/knowledge/documents/${documentId}`)
        .set(customer)
        .send({ active: true })
        .expect(403);
      // The normal worker may claim the upload first; inspect persisted status rather than assuming synchronous work.
      for (let i = 0; i < 30; i++) {
        const d = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
        filePath = d.filePath || '';
        if (d.status === 'READY') break;
        assert.notEqual(d.status, 'FAILED', d.error || 'Ingestion failed');
        await processOneDocument();
        await setTimeout(100);
      }
      const d = await db.knowledgeDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { chunks: true },
      });
      assert.equal(d.status, 'READY');
      assert(d.chunks.length > 0);
      assert.equal(d.active, false);
      await request(app)
        .patch(`/api/v1/knowledge/documents/${documentId}`)
        .set(admin)
        .send({ active: true })
        .expect(200);
      const question = {
        question: `${marker} tieraccess`,
        category: 'TEST',
        documentType: 'MANUAL',
      };
      const standard = await request(app)
        .post('/api/v1/assistant/ask')
        .set(customer)
        .send(question)
        .expect(200);
      assert.equal(standard.body.sources.length, 0);
      await request(app)
        .get(`/api/v1/knowledge/sources/${d.chunks[0].id}`)
        .set(customer)
        .expect(404);
      await request(app)
        .patch(`/api/v1/operations/users/${userId}`)
        .set(admin)
        .send({ tier: 'GOLD' })
        .expect(200);
      const gold = await request(app)
        .post('/api/v1/assistant/ask')
        .set(customer)
        .send(question)
        .expect(200);
      assert(
        gold.body.sources.some((s: { chunkId: string }) =>
          d.chunks.some((c) => c.id === s.chunkId),
        ),
      );
      await request(app)
        .get(`/api/v1/knowledge/sources/${d.chunks[0].id}`)
        .set(customer)
        .expect(200);
      const wrongType = await request(app)
        .post('/api/v1/assistant/ask')
        .set(customer)
        .send({ ...question, documentType: 'POLICY' })
        .expect(200);
      assert.equal(wrongType.body.sources.length, 0);
      await request(app)
        .patch('/api/v1/auth/me')
        .set(customer)
        .send({
          preferences: { categories: ['Computers'], budget: 60000, storeId: 'store-mumbai' },
        })
        .expect(200);
      const profile = await request(app).get('/api/v1/auth/me').set(customer).expect(200);
      assert.equal(profile.body.preferences.storeId, 'store-mumbai');
      const ticket = await request(app)
        .post('/api/v1/support/tickets')
        .set(customer)
        .send({
          subject: 'Integration support',
          description: 'Please check this demo support request.',
          locationId: 'store-bengaluru',
        })
        .expect(201);
      assert.equal(ticket.body.priority, 'HIGH');
      await request(app)
        .post(`/api/v1/support/tickets/${ticket.body.id}/replies`)
        .set(mumbaiManager)
        .send({ body: 'Wrong store answer' })
        .expect(403);
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(mumbaiManager)
        .send({ status: 'ESCALATED' })
        .expect(403);
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(customer)
        .send({ status: 'RESOLVED' })
        .expect(403);
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(manager)
        .send({ status: 'RESOLVED' })
        .expect(400);
      await request(app)
        .post(`/api/v1/support/tickets/${ticket.body.id}/replies`)
        .set(customer)
        .send({ body: 'Unauthorized answer' })
        .expect(403);
      await request(app)
        .post(`/api/v1/support/tickets/${ticket.body.id}/replies`)
        .set(manager)
        .send({ body: 'Your request was checked by your assigned store manager.' })
        .expect(201);
      const customerTickets = await request(app)
        .get('/api/v1/support/tickets')
        .set(customer)
        .expect(200);
      assert.equal(
        customerTickets.body[0].replies[0].body,
        'Your request was checked by your assigned store manager.',
      );
      assert.equal(customerTickets.body[0].replies[0].authorRole, 'STORE_MANAGER');
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(admin)
        .send({ status: 'ESCALATED' })
        .expect(403);
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(manager)
        .send({ status: 'ESCALATED' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/support/tickets/${ticket.body.id}`)
        .set(admin)
        .send({ status: 'RESOLVED' })
        .expect(200);
      await request(app)
        .post(`/api/v1/support/tickets/${ticket.body.id}/replies`)
        .set(admin)
        .send({ body: 'Cannot answer a closed ticket' })
        .expect(409);
      await db.auditLog.deleteMany({ where: { resourceId: ticket.body.id } });
      await request(app)
        .patch(`/api/v1/operations/users/${userId}`)
        .set(admin)
        .send({ role: 'STORE_MANAGER', storeIds: ['store-mumbai'] })
        .expect(200);
      await request(app)
        .get('/api/v1/operations/inventory?storeId=store-mumbai')
        .set(customer)
        .expect(200);
      await request(app)
        .get('/api/v1/operations/inventory?storeId=store-bengaluru')
        .set(customer)
        .expect(403);
      await request(app)
        .patch(`/api/v1/operations/users/${userId}`)
        .set(admin)
        .send({ role: 'CUSTOMER', storeIds: [] })
        .expect(200);
      await request(app).get('/api/v1/operations/inventory').set(customer).expect(403);
    } finally {
      if (documentId) {
        await db.auditLog.deleteMany({ where: { resourceId: documentId } });
        await db.knowledgeDocument.delete({ where: { id: documentId } });
      }
      if (filePath) await unlink(filePath).catch(() => {});
      if (userId) {
        await db.auditLog.deleteMany({ where: { resourceId: userId } });
        await db.supportTicket.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
      await db.authSession.deleteMany({ where: { id: { in: staffSessions } } });
      await db.$disconnect();
    }
  },
);
