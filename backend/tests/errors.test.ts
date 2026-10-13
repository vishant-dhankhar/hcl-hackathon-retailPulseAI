import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

test('Malformed and oversized form requests return useful errors without leaking internals', async () => {
  const malformed = await request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send('{invalid')
    .expect(400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
  const oversized = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'test@example.com', password: 'x'.repeat(110000) })
    .expect(413);
  assert.equal(oversized.body.error.code, 'REQUEST_TOO_LARGE');
  assert(!JSON.stringify(oversized.body).includes('stack'));
  const invalid = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'invalid', password: 'short', name: '' })
    .expect(400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});
