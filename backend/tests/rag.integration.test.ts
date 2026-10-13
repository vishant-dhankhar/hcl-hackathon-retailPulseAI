import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/config/database.js';
import { answer } from '../src/services/knowledge.service.js';
import { embedMany } from '../src/services/ai.service.js';
import { approvedActions } from '../src/services/actions.service.js';
import type { Actor } from '../src/middleware/authorize.js';

test(
  'pgvector RAG filters scope before ranking, validates citations and bounds chat context',
  { skip: process.env.RUN_DB_TESTS !== 'true', timeout: 150000 },
  async (t) => {
    const previous = {
      AI_API_KEY: process.env.AI_API_KEY,
      AI_MODEL: process.env.AI_MODEL,
      EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
      EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    };
    Object.assign(process.env, {
      AI_API_KEY: 'local-mock',
      AI_MODEL: 'mock-chat',
      EMBEDDING_API_KEY: 'local-mock',
      EMBEDDING_MODEL: 'rag-test-model',
    });
    const ids: string[] = [];
    let allowedChunk = '';
    let invalid = false;
    let insufficient = false;
    let badEmbedding = false;
    let rewrites = 0;
    const marker = randomUUID();
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      if (String(url).endsWith('/embeddings')) {
        assert.equal(payload.dimensions, 1536);
        return Response.json({
          data: payload.input
            .map((_text: string, index: number) => ({
              index,
              embedding: badEmbedding ? [1, 0] : vector,
            }))
            .reverse(),
        });
      }
      const input = JSON.parse(payload.messages[1].content);
      if (!input.evidence) {
        rewrites++;
        assert.equal(input.history.length, 2);
        return Response.json({
          choices: [
            {
              message: { content: JSON.stringify({ question: `${marker} Gold support priority` }) },
            },
          ],
        });
      }
      assert(input.evidence.length > 0);
      assert(
        input.evidence.every((e: { id: string }) => e.id === allowedChunk),
        'Inapplicable evidence reached the model',
      );
      assert.equal(input.membershipTier, 'GOLD');
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: insufficient
                  ? 'I cannot confirm that from the approved policy.'
                  : 'Gold support priority is HIGH.',
                sourceIds: insufficient ? [] : [invalid ? 'invented-source' : allowedChunk],
                followUpRequired: insufficient,
              }),
            },
          },
        ],
      });
    });
    try {
      const user = await db.user.findUniqueOrThrow({ where: { email: 'gold@retailpulse.demo' } });
      const actor: Actor = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'CUSTOMER',
        tier: 'GOLD',
        storeIds: [],
        sessionId: 'test',
      };
      for (const scope of [
        'allowed',
        'wrong-tier',
        'expired',
        'future',
        'draft',
        'wrong-role',
        'wrong-category',
      ]) {
        const doc = await db.knowledgeDocument.create({
          data: {
            title: `RAG test ${marker} ${scope}`,
            version: 'test-1',
            category: scope === 'wrong-category' ? 'OTHER' : 'RAG_TEST',
            documentType: 'MANUAL',
            tiers: scope === 'wrong-tier' ? ['STANDARD'] : ['GOLD'],
            audience: scope === 'wrong-role' ? ['ADMIN'] : ['CUSTOMER'],
            active: scope !== 'draft',
            status: 'READY',
            embeddingModel: 'rag-test-model',
            retrievalMode: 'VECTOR',
            effectiveFrom: new Date(Date.now() + (scope === 'future' ? 86400000 : -86400000)),
            ...(scope === 'expired' ? { effectiveTo: new Date(Date.now() - 1000) } : {}),
            chunks: {
              create: { section: 'Support', content: `${marker} Gold support priority is HIGH.` },
            },
          },
          include: { chunks: true },
        });
        ids.push(doc.id);
        if (scope === 'allowed') allowedChunk = doc.chunks[0].id;
        await db.$executeRaw`UPDATE "DocumentChunk" SET embedding=${JSON.stringify(vector)}::vector WHERE "documentId"=${doc.id}`;
      }
      assert.equal((await embedMany(['first', 'second'])).length, 2);
      const result = await answer(actor, `${marker} Gold support priority`, 'RAG_TEST', 'MANUAL');
      assert.equal(result.mode, 'VECTOR_AI');
      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].chunkId, allowedChunk);
      const followup = await answer(actor, 'And my priority?', 'RAG_TEST', 'MANUAL', [
        { role: 'user', content: 'I am a Gold member.' },
        { role: 'assistant', content: 'Tell me your question.' },
      ]);
      assert.equal(rewrites, 1);
      assert.equal(followup.sources[0].chunkId, allowedChunk);
      invalid = true;
      await assert.rejects(answer(actor, marker, 'RAG_TEST', 'MANUAL'), {
        code: 'INVALID_AI_SOURCE',
      });
      invalid = false;
      insufficient = true;
      const missing = await answer(
        actor,
        'Does this give me unlimited refunds?',
        'RAG_TEST',
        'MANUAL',
      );
      assert.equal(missing.mode, 'NO_EVIDENCE');
      assert.equal(missing.sources.length, 0);
      assert.equal(missing.followUpRequired, true);
      badEmbedding = true;
      await assert.rejects(embedMany(['invalid dimensions']));
      badEmbedding = false;
      assert.deepEqual(
        approvedActions(actor).map((a) => a.id),
        ['orders', 'support'],
      );
      assert(
        !approvedActions({ ...actor, role: 'STORE_MANAGER' }).some((a) => a.id === 'policies'),
      );
      assert(approvedActions({ ...actor, role: 'ADMIN' }).some((a) => a.id === 'policies'));
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: process.env.DEMO_PASSWORD })
        .expect(200);
      try {
        const auth = { Authorization: `Bearer ${login.body.accessToken}` };
        await request(app)
          .post('/api/v1/assistant/ask')
          .set(auth)
          .send({
            question: 'Policy question',
            history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'hello' })),
          })
          .expect(400);
        const actions = await request(app).get('/api/v1/assistant/actions').set(auth).expect(200);
        assert.deepEqual(
          actions.body.map((a: { id: string }) => a.id),
          ['orders', 'support'],
        );
        await request(app)
          .post(`/api/v1/knowledge/documents/${ids[0]}/reindex`)
          .set(auth)
          .expect(403);
      } finally {
        const sid = JSON.parse(
          Buffer.from(login.body.accessToken.split('.')[1], 'base64url').toString(),
        ).sid;
        await db.authSession.delete({ where: { id: sid } });
      }
      await db.knowledgeDocument.update({ where: { id: ids[0] }, data: { active: false } });
      const retired = await answer(actor, marker, 'RAG_TEST', 'MANUAL');
      assert.equal(retired.mode, 'NO_EVIDENCE');
      assert.equal(retired.sources.length, 0);
    } finally {
      await db.knowledgeDocument.deleteMany({ where: { id: { in: ids } } });
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await db.$disconnect();
    }
  },
);
