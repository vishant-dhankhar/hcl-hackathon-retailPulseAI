import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryPaise, canTransition, toPaise, rupees } from '../src/lib/pricing.js';
test('Silver standard delivery threshold and Gold express charge are distinct', () => {
  assert.equal(deliveryPaise('SILVER', 199899, 'DELIVERY', false), 9900);
  assert.equal(deliveryPaise('SILVER', 199900, 'DELIVERY', false), 0);
  assert.equal(deliveryPaise('GOLD', 50000, 'DELIVERY', false), 0);
  assert.equal(deliveryPaise('GOLD', 50000, 'DELIVERY', true), 9900);
  assert.equal(deliveryPaise('PLATINUM', 50000, 'DELIVERY', true), 0);
});
test('Pickup is free and fulfillment status paths cannot cross', () => {
  assert.equal(deliveryPaise('STANDARD', 50000, 'PICKUP', true), 0);
  assert.equal(canTransition('PLACED', 'SHIPPED', 'DELIVERY'), false);
  assert.equal(canTransition('PLACED', 'READY_FOR_PICKUP', 'PICKUP'), true);
  assert.equal(canTransition('READY_FOR_PICKUP', 'CANCELLED', 'PICKUP'), false);
  assert.equal(toPaise('19.99'), 1999);
  assert.equal(rupees(1999), '19.99');
});
