import test from 'node:test';
import assert from 'node:assert/strict';
import { appId, routes } from '../src/index.ts';

test('dentex app pack exports appId and route definitions', () => {
  assert.equal(appId, 'app_dentex');
  const r = routes();
  assert.ok(r.length >= 2);
  assert.ok(r.some((route) => route.path === '/v1/bookings' && route.method === 'POST'));
  assert.ok(r.some((route) => route.path === '/v1/bookings' && route.method === 'GET'));
  for (const route of r) {
    assert.equal(route.appId, 'app_dentex');
  }
});
