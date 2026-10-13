import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { chat } from '../src/services/chat.service.js';
import { listChatProducts } from '../src/services/chat-catalogue.service.js';
import type { Actor } from '../src/middleware/authorize.js';
import { HttpError } from '../src/errors/HttpError.js';

test(
  'Catalogue chat lists Bandra without clarification and supports category, paging and sorting',
  {
    skip: process.env.RUN_DB_TESTS !== 'true',
    timeout: 90000,
  },
  async (t) => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@retailpulse.demo' } });
    const actor: Actor = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'ADMIN',
      tier: user.tier,
      storeIds: [],
      sessionId: 'catalogue-test',
    };
    const oldKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'local-model-mock';
    let output: Record<string, unknown> = { intent: 'PRODUCTS', locationId: 'store-mumbai' };
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
    });
    const ask = (
      question: string,
      history: { role: 'user' | 'assistant'; content: string }[] = [],
    ) => chat(actor, { question, history, storeId: 'store-bengaluru' });
    try {
      const first = await ask('list all the available products in bandra store');
      assert.equal(first.mode, 'CATALOGUE');
      assert.equal(first.storeId, 'store-mumbai');
      assert.equal(first.followUpRequired, false);
      assert.equal(first.products?.length, 10);
      assert(first.answer.includes('Bandra, Mumbai'));
      assert.equal(calls, 1, 'Listing must not call the recommendation/clarification model');
      const total = await db.product.count({
        where: {
          active: true,
          inventory: { some: { locationId: 'store-mumbai', quantity: { gt: 0 } } },
        },
      });
      assert(first.answer.includes(`${total} matching products`));
      output = { intent: 'CATALOGUE', locationId: null, category: null, search: 'electronics' };
      const history = [
        { role: 'user' as const, content: 'list all the available products in bandra store' },
        { role: 'assistant' as const, content: first.answer },
      ];
      const electronics = await ask('electronics', history);
      assert(electronics.products!.length > 0);
      assert(
        electronics.products!.every((p) =>
          ['Audio', 'Computers', 'Mobiles', 'Wearables'].includes(p.product.category),
        ),
      );
      assert.equal(electronics.storeId, 'store-mumbai');
      assert.equal(electronics.followUpRequired, false);
      output = { intent: 'CATALOGUE', locationId: null, category: null, page: null };
      const next = await ask('next page', [
        ...history,
        { role: 'assistant', content: electronics.answer },
      ]);
      assert(
        next.products!.every(
          (p) => !electronics.products!.some((previous) => previous.productId === p.productId),
        ),
      );
      assert(next.answer.includes('Page 2'));
      // A new ranking request resets an unrelated category and uses the explicitly named store,
      // even if the model misroutes it and copies earlier filters. The store typo is intentional.
      output = {
        intent: 'PRODUCTS',
        locationId: 'store-mumbai',
        category: 'Audio',
        search: 'cheapest product',
        maxPrice: 1000,
        sort: 'name',
      };
      const cheapest = await ask('cheapest product in indranagaer store', [
        ...history,
        { role: 'assistant', content: electronics.answer },
      ]);
      assert.equal(cheapest.mode, 'CATALOGUE');
      assert.equal(cheapest.storeId, 'store-bengaluru');
      const cheapestDb = await db.product.findFirstOrThrow({
        where: {
          active: true,
          inventory: { some: { locationId: 'store-bengaluru', quantity: { gt: 0 } } },
        },
        orderBy: [{ price: 'asc' }, { id: 'asc' }],
      });
      assert.equal(cheapest.products![0].productId, cheapestDb.id);
      assert(cheapest.answer.includes('Category: All products'));
      assert(cheapest.answer.includes('Sort: price-asc'));
      output = { intent: 'PRODUCTS', locationId: null, category: null, sort: 'name' };
      const cheapestElectronics = await ask('electronics', [
        { role: 'user', content: 'cheapest product in indranagaer store' },
        { role: 'assistant', content: cheapest.answer },
      ]);
      assert.equal(cheapestElectronics.storeId, 'store-bengaluru');
      assert(cheapestElectronics.answer.includes('Sort: price-asc'));
      assert(
        cheapestElectronics.products!.every((p) =>
          ['Audio', 'Computers', 'Mobiles', 'Wearables'].includes(p.product.category),
        ),
      );
      const recoveredCheapest = await ask('electronics', [
        { role: 'user', content: 'cheapest product in indranagaer store' },
        {
          role: 'assistant',
          content:
            'cheapest product in Indranagar store. What category or type of product are you looking for in the Indranagar store?',
        },
      ]);
      assert.equal(recoveredCheapest.mode, 'CATALOGUE');
      assert.equal(recoveredCheapest.storeId, 'store-bengaluru');
      assert(recoveredCheapest.answer.includes('Sort: price-asc'));
      output = { intent: 'PRODUCTS', category: 'Computers', search: 'laptop', sort: 'name' };
      const laptops = await ask('least expensive laptop in Indiranagar');
      assert(laptops.products!.length > 0);
      assert(laptops.products!.every((p) => /laptop/i.test(p.product.name)));
      assert(laptops.answer.includes('Sort: price-asc'));
      output = { intent: 'PRODUCTS', category: 'Electronics', search: null, sort: 'name' };
      const costliest = await ask('most expensive electronics in Bandra');
      assert(
        costliest.products!.every(
          (p, i, all) => i === 0 || Number(p.product.price) <= Number(all[i - 1].product.price),
        ),
      );
      assert(costliest.answer.includes('Sort: price-desc'));
      const rated = await ask('top rated electronics in Bandra');
      assert(
        rated.products!.every(
          (p, i, all) => i === 0 || Number(p.product.rating) <= Number(all[i - 1].product.rating),
        ),
      );
      assert(rated.answer.includes('Sort: rating'));
      const sorted = await listChatProducts(actor, {
        storeId: 'store-mumbai',
        category: 'Computers',
        maxPrice: 60000,
        search: null,
        page: 1,
        sort: 'price-asc',
      });
      assert(sorted.products.length > 0);
      assert(
        sorted.products.every(
          (p) => p.product.category === 'Computers' && Number(p.product.price) <= 60000,
        ),
      );
      assert(
        sorted.products.every(
          (p, i, all) => i === 0 || Number(p.product.price) >= Number(all[i - 1].product.price),
        ),
      );
      const customer = await listChatProducts(
        { ...actor, role: 'CUSTOMER' },
        {
          storeId: 'store-mumbai',
          category: null,
          maxPrice: null,
          search: null,
          page: 1,
          sort: 'name',
        },
      );
      assert(
        customer.products[0].actions.every(
          (a) => a.kind === 'ADD_CART' && a.storeId === 'store-mumbai',
        ),
      );
      const unknown = await listChatProducts(actor, {
        storeId: 'store-mumbai',
        category: 'Furniture',
        maxPrice: null,
        search: null,
        page: 1,
        sort: 'name',
      });
      assert.equal(unknown.products.length, 0);
      assert(unknown.answer.includes('Available categories:'));
      await assert.rejects(
        () =>
          listChatProducts(
            { ...actor, role: 'CUSTOMER' },
            {
              storeId: 'warehouse-central',
              category: null,
              maxPrice: null,
              search: null,
              page: 1,
              sort: 'name',
            },
          ),
        (e) => e instanceof HttpError && e.status === 403,
      );
    } finally {
      t.mock.restoreAll();
      if (oldKey === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = oldKey;
      await db.$disconnect();
    }
  },
);
