import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { recommend } from '../src/services/assistant.service.js';
import type { Actor } from '../src/middleware/authorize.js';
import { HttpError } from '../src/errors/HttpError.js';
test(
  'Recommendations enforce interpreted budget, specifications and catalogue IDs',
  { skip: process.env.RUN_DB_TESTS !== 'true', timeout: 60000 },
  async (t) => {
    const previousKey = process.env.AI_API_KEY;
    const previousModel = process.env.AI_MODEL;
    process.env.AI_API_KEY = 'local-test-only';
    process.env.AI_MODEL = 'mock-model';
    let calls = 0;
    let invalidId = false;
    // Mock only model responses; all catalogue and stock constraints are checked against the real seeded database.
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      calls++;
      const payload = JSON.parse(String(options.body));
      const input = JSON.parse(payload.messages[1].content);
      let output;
      if (calls % 2 === 1)
        output = {
          interpretedRequirement: 'Laptop for Java development, 16 GB RAM, under INR 60000',
          category: 'Computers',
          brand: null,
          maxPrice: 60000,
          requiredSpecifications: ['16 GB RAM'],
          clarifyingQuestion: null,
        };
      else {
        assert(input.products.length > 0);
        assert(
          input.products.every(
            (p: { price: string; description: string }) =>
              Number(p.price) <= 60000 && p.description.includes('16 GB RAM'),
          ),
        );
        output = {
          interpretedRequirement: 'A matching development laptop',
          recommendations: [
            {
              productId: invalidId ? 'invented-product' : input.products[0].id,
              reason: 'Matches the requested RAM and budget.',
            },
          ],
          clarifyingQuestion: null,
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
    try {
      const u = await db.user.findUniqueOrThrow({ where: { email: 'customer@retailpulse.demo' } });
      const actor: Actor = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        tier: u.tier,
        storeIds: [],
        sessionId: 'local-test-session',
      };
      const result = await recommend(actor, {
        question: 'Laptop for Java development, 16 GB RAM under 60000',
        storeId: 'store-bengaluru',
      });
      assert(result.recommendations.length > 0);
      assert.equal(calls, 2);
      invalidId = true;
      await assert.rejects(
        () =>
          recommend(actor, {
            question: 'Laptop 16 GB RAM under 60000',
            storeId: 'store-bengaluru',
          }),
        (e) => e instanceof HttpError && e.code === 'INVALID_RECOMMENDATION',
      );
    } finally {
      t.mock.restoreAll();
      if (previousKey === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previousKey;
      if (previousModel === undefined) delete process.env.AI_MODEL;
      else process.env.AI_MODEL = previousModel;
      await db.$disconnect();
    }
  },
);
