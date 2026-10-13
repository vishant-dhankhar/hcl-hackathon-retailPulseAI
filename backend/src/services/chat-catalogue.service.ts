import { db } from '../config/database.js';
import { assert } from '../errors/HttpError.js';
import { storeAccess, type Actor } from '../middleware/authorize.js';
import type { Prisma } from '../generated/prisma/client.js';

// Explicit ranking is a database sort, even when the router calls it a recommendation.
export function catalogueSort(question: string) {
  if (/\b(?:most expensive|costliest|highest price|high to low|price descending)\b/i.test(question))
    return 'price-desc' as const;
  if (/\b(?:cheapest|least expensive|lowest price|low to high|price ascending)\b/i.test(question))
    return 'price-asc' as const;
  if (/\b(?:top[- ]rated|highest[- ]rated|best[- ]rated|highest rating)\b/i.test(question))
    return 'rating' as const;
  return null;
}

// Allow a small typo in a long location name only when it identifies one unique store.
// This resolves names, not access rights; the database capability still checks permissions.
export function namedCatalogueStore<T extends { name: string; city: string; warehouse: boolean }>(
  question: string,
  locations: T[],
) {
  const text = question.toLowerCase();
  const exact =
    locations.find((l) => text.includes(l.name.toLowerCase())) ||
    locations.find(
      (l) => !l.warehouse && !/\bwarehouse\b/i.test(text) && text.includes(l.city.toLowerCase()),
    );
  if (exact) return exact;
  const words = text.match(/[a-z]+/g) || [];
  function distance(a: string, b: string) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
      row = next;
    }
    return row[b.length];
  }
  const matches = locations.filter(
    (l) =>
      !l.warehouse &&
      [l.name, l.city].some((label) =>
        label
          .toLowerCase()
          .split(/[^a-z]+/)
          .some(
            (part) =>
              part.length >= 7 &&
              words.some((word) => word.length >= 7 && distance(word, part) <= 2),
          ),
      ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

// Browsing is a database listing, not a model-selected shortlist. Every matching row is pageable.
export async function listChatProducts(
  actor: Actor,
  input: {
    storeId: string;
    category: string | null;
    search: string | null;
    maxPrice: number | null;
    sort: 'name' | 'price-asc' | 'price-desc' | 'rating';
    page: number;
  },
) {
  const store = await db.location.findUnique({ where: { id: input.storeId } });
  assert(store, 400, 'INVALID_STORE', 'Select an existing store.');
  if (store.warehouse) storeAccess(actor, store.id);
  const facets = await db.product.findMany({
    where: { active: true, inventory: { some: { locationId: store.id, quantity: { gt: 0 } } } },
    select: { category: true },
    distinct: ['category'],
  });
  const availableCategories = facets.map((p) => p.category).sort();
  const requested = input.category?.trim();
  const broad = requested?.toLowerCase() === 'electronics';
  const exact = availableCategories.find((c) => c.toLowerCase() === requested?.toLowerCase());
  const categories = broad
    ? availableCategories.filter((c) => ['Audio', 'Computers', 'Mobiles', 'Wearables'].includes(c))
    : exact
      ? [exact]
      : [];
  const unknownCategory =
    requested && !['all', 'all products'].includes(requested.toLowerCase()) && !broad && !exact;
  if (unknownCategory)
    return {
      answer: `There is no “${requested}” category available at ${store.name}, ${store.city}. Available categories: ${availableCategories.join(', ') || 'none'}. Which of these would you like to browse?`,
      mode: 'CATALOGUE',
      confidence: 'VERIFIED',
      sources: [],
      followUpRequired: true,
      products: [],
      storeId: store.id,
    };
  const where: Prisma.ProductWhereInput = {
    active: true,
    inventory: { some: { locationId: store.id, quantity: { gt: 0 } } },
    ...(broad || exact ? { category: { in: categories } } : {}),
    ...(input.search
      ? {
          OR: ['name', 'brand', 'description'].map((field) => ({
            [field]: { contains: input.search!, mode: 'insensitive' },
          })),
        }
      : {}),
    ...(input.maxPrice ? { price: { lte: input.maxPrice } } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    input.sort === 'price-asc'
      ? [{ price: 'asc' }, { id: 'asc' }]
      : input.sort === 'price-desc'
        ? [{ price: 'desc' }, { id: 'asc' }]
        : input.sort === 'rating'
          ? [{ rating: 'desc' }, { id: 'asc' }]
          : [{ name: 'asc' }, { id: 'asc' }];
  const limit = 10;
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * limit,
      take: limit,
      include: { inventory: { where: { locationId: store.id }, select: { quantity: true } } },
    }),
  ]);
  const pages = Math.ceil(total / limit);
  const categoryLabel = broad ? `Electronics (${categories.join(', ')})` : exact || 'All products';
  return {
    answer: `Available products at ${store.name}, ${store.city}. Category: ${categoryLabel}. ${total} matching products. Page ${input.page} of ${Math.max(1, pages)}; showing ${products.length}.${input.maxPrice ? ` Budget: up to ₹${input.maxPrice}.` : ''}${input.search ? ` Search: ${input.search}.` : ''} Sort: ${input.sort}.${input.page < pages ? ' Ask “next page” to see more.' : !products.length && total ? ' Ask for page 1 to return to the results.' : ''}`,
    mode: 'CATALOGUE',
    confidence: 'VERIFIED',
    sources: [],
    followUpRequired: false,
    storeId: store.id,
    products: products.map((p) => ({
      productId: p.id,
      product: p,
      availability: 'IN_STOCK',
      reason: `${p.category} · ${p.inventory[0].quantity} available · ${p.description}`,
      actions:
        actor.role === 'CUSTOMER'
          ? [
              {
                kind: 'ADD_CART',
                targetId: p.id,
                storeId: store.id,
                quantity: 1,
                label: 'Review adding to cart',
              },
            ]
          : [],
    })),
  };
}
