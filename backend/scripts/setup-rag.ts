import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { db } from '../src/config/database.js';
import { embeddingKey } from '../src/services/ai.service.js';

// Demo setup goes through the same admin-only HTTP endpoints as the interface.
// It replaces only the known seeded demo versions after the new upload is READY.
if (process.env.NODE_ENV === 'production')
  throw new Error('Run sample policy setup only in development.');
if (!embeddingKey()) throw new Error('Set OPENAI_API_KEY in backend/.env first.');
const base = 'http://127.0.0.1:4000/api/v1';
let token = '';
let cookie = '';
async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('x-requested-with', 'RetailPulse');
  headers.set('Origin', process.env.APP_ORIGIN || 'http://127.0.0.1:5173');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (cookie) headers.set('Cookie', cookie);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(base + path, {
    ...options,
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  if (path === '/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  return data;
}
try {
  const extension = await db.$queryRaw<
    { extversion: string }[]
  >`SELECT extversion FROM pg_extension WHERE extname='vector'`;
  if (!extension.length) throw new Error('Apply the Prisma migrations to enable pgvector.');
  console.log(`pgvector ${extension[0].extversion} available.`);
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@retailpulse.demo', password: process.env.DEMO_PASSWORD }),
  });
  token = login.accessToken;
  const files = [
    { file: 'delivery-membership.md', title: 'Delivery and membership policy', version: 'demo-2' },
    { file: 'returns-warranty.md', title: 'Returns and warranty policy', version: 'demo-2' },
    { file: 'orders-support.md', title: 'Orders, support and inventory policy', version: 'demo-1' },
  ];
  const policyIds: string[] = [];
  for (const item of files) {
    let documents = await api('/knowledge/documents');
    let doc = documents.find(
      (d: { title: string; version: string }) =>
        d.title === item.title && d.version === item.version,
    );
    if (!doc) {
      const form = new FormData();
      form.append(
        'metadata',
        JSON.stringify({
          title: item.title,
          version: item.version,
          category: 'ALL',
          country: 'IN',
          documentType: 'POLICY',
          tiers: ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'],
          audience: ['CUSTOMER', 'STORE_MANAGER', 'ADMIN'],
          effectiveFrom: new Date('2026-10-10T00:00:00+05:30').toISOString(),
        }),
      );
      form.append(
        'file',
        new Blob([await readFile(resolve('..', 'policies', item.file))], { type: 'text/markdown' }),
        item.file,
      );
      doc = await api('/knowledge/documents', { method: 'POST', body: form });
      console.log(`Uploaded ${item.title}.`);
    } else if (
      doc.status === 'FAILED' ||
      (doc.status === 'READY' && doc.retrievalMode !== 'VECTOR')
    ) {
      await api(`/knowledge/documents/${doc.id}/reindex`, { method: 'POST' });
    }
    for (let attempt = 0; attempt < 90; attempt++) {
      documents = await api('/knowledge/documents');
      doc = documents.find((d: { id: string }) => d.id === doc.id);
      if (doc.status === 'FAILED') throw new Error(`${item.title}: ${doc.error}`);
      if (doc.status === 'READY') break;
      await setTimeout(1000);
    }
    if (doc.status !== 'READY' || doc.retrievalMode !== 'VECTOR')
      throw new Error(`${item.title} is not vector-ready. Check the worker.`);
    for (const old of documents.filter(
      (d: { title: string; version: string; active: boolean }) =>
        d.title === item.title && d.version === 'demo-1' && d.active && d.version !== item.version,
    ))
      await api(`/knowledge/documents/${old.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
    if (!doc.active)
      await api(`/knowledge/documents/${doc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    console.log(`Active with OpenAI embeddings: ${item.title}.`);
    policyIds.push(doc.id);
  }
  const vectors = await db.$queryRaw<
    { count: number }[]
  >`SELECT COUNT(*)::int AS count FROM "DocumentChunk" c JOIN "KnowledgeDocument" d ON d.id=c."documentId" WHERE d.id = ANY(${policyIds}::text[]) AND d.active AND d.status='READY' AND c.embedding IS NOT NULL AND vector_dims(c.embedding)=1536`;
  console.log(`${vectors[0].count} active policy vectors verified (1536 dimensions).`);
} catch (e) {
  console.error(e instanceof Error ? e.message : 'RAG setup failed.');
  process.exitCode = 1;
} finally {
  if (token) await api('/auth/logout', { method: 'POST' }).catch(() => {});
  await db.$disconnect();
}
