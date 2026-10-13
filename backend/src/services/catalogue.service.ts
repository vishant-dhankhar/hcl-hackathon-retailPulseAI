import { z } from 'zod';

import { db } from '../config/database.js';

import { assert } from '../errors/HttpError.js';

import type { Prisma } from '../generated/prisma/client.js';

export async function listStores() {
  return await db.location.findMany({ where: { warehouse: false }, orderBy: { name: 'asc' } });
}

export async function listProducts(query: Record<string, unknown>) {
  const q = z
    .object({
      search: z.string().max(100).optional(),
      category: z.string().max(40).optional(),
      brand: z.string().max(40).optional(),
      storeId: z.string().optional(),
      sort: z.enum(['featured', 'price-asc', 'price-desc', 'rating']).default('featured'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
      maxPrice: z.coerce.number().positive().optional(),
      specification: z.string().trim().min(1).max(100).optional(),
      inStock: z.enum(['true', 'false']).optional(),
      minRating: z.coerce.number().min(0).max(5).optional(),
      attributes: z.string().max(2000).optional(),
    })
    .parse(query);
  if (q.storeId)
    assert(
      await db.location.findUnique({ where: { id: q.storeId, warehouse: false } }),
      400,
      'INVALID_STORE',
      'Select an existing store.',
    );
  let selectedAttributes: Record<string, string> = {};
  if (q.attributes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(q.attributes);
    } catch {
      assert(false, 400, 'INVALID_FILTER', 'Invalid product filters.');
    }
    selectedAttributes = z
      .record(z.string().min(1).max(40), z.string().min(1).max(100))
      .refine((v) => Object.keys(v).length <= 10, 'Too many specification filters.')
      .parse(parsed);
    assert(
      q.category,
      400,
      'CATEGORY_REQUIRED',
      'Choose a category before filtering specifications.',
    );
  }
  const scope: Prisma.ProductWhereInput = {
    active: true,
    ...(q.storeId ? { inventory: { some: { locationId: q.storeId } } } : {}),
  };
  const where: Prisma.ProductWhereInput = {
    ...scope,
    ...(q.search
      ? {
          OR: ['name', 'brand', 'description'].map((field) => ({
            [field]: { contains: q.search, mode: 'insensitive' },
          })),
        }
      : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.brand ? { brand: q.brand } : {}),
    ...(q.specification ? { description: { contains: q.specification, mode: 'insensitive' } } : {}),
    ...(q.maxPrice ? { price: { lte: q.maxPrice } } : {}),
    ...(q.minRating ? { rating: { gte: q.minRating } } : {}),
    ...(Object.keys(selectedAttributes).length
      ? {
          AND: Object.entries(selectedAttributes).map(([key, value]) => ({
            specifications: { path: ['attributes', key], equals: value },
          })),
        }
      : {}),
    ...(q.storeId || q.inStock === 'true'
      ? {
          inventory: {
            some: {
              ...(q.storeId ? { locationId: q.storeId } : {}),
              ...(q.inStock === 'true' ? { quantity: { gt: 0 } } : {}),
            },
          },
        }
      : {}),
  };
  // A unique final sort key keeps products with identical prices or ratings in a stable order across pages.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === 'price-asc'
      ? [{ price: 'asc' }, { id: 'asc' }]
      : q.sort === 'price-desc'
        ? [{ price: 'desc' }, { id: 'asc' }]
        : q.sort === 'rating'
          ? [{ rating: 'desc' }, { id: 'asc' }]
          : [{ featured: 'desc' }, { name: 'asc' }, { id: 'asc' }];
  const [items, total, categories, brands, specifications] = await Promise.all([
    db.product.findMany({
      where,
      include: { inventory: { where: q.storeId ? { locationId: q.storeId } : {} } },
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.product.count({ where }),
    db.product.findMany({
      where: scope,
      select: { category: true },
      distinct: ['category'],
    }),
    db.product.findMany({
      where: { ...scope, ...(q.category ? { category: q.category } : {}) },
      select: { brand: true },
      distinct: ['brand'],
    }),
    q.category
      ? db.product.findMany({
          where: { ...scope, category: q.category },
          select: { specifications: true },
        })
      : Promise.resolve([]),
  ]);
  const attributeOptions: Record<string, string[]> = {};
  for (const product of specifications) {
    const values = z
      .object({ attributes: z.record(z.string(), z.string()).optional() })
      .safeParse(product.specifications);
    if (values.success)
      for (const [key, value] of Object.entries(values.data.attributes || {})) {
        attributeOptions[key] = [...new Set([...(attributeOptions[key] || []), value])].sort();
      }
  }
  return {
    items: items.map((p) => ({
      ...p,
      availability: p.inventory.reduce((n, i) => n + i.quantity, 0),
    })),
    total,
    page: q.page,
    limit: q.limit,
    pages: Math.ceil(total / q.limit),
    categories: categories.map((c) => c.category).sort(),
    brands: brands.map((b) => b.brand).sort(),
    attributeOptions,
  };
}

export async function getProduct(id: string) {
  const p = await db.product.findUnique({
    where: { id: String(id), active: true },
    include: { inventory: { include: { location: true } } },
  });
  assert(p, 404, 'NOT_FOUND', 'Product not found.');
  return p;
}
