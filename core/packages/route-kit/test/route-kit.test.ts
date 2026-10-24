import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readJson, parsePagination, notFound, badRequest, forbidden, RouteKitHttpError } from '../src/index.ts';

function createMockReq(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(body));
      this.push(null);
    },
  });
  (stream as any).headers = headers;
  return stream as unknown as IncomingMessage;
}

test('readJson parses valid JSON body', async () => {
  const req = createMockReq('{"name":"Alice","count":42}');
  const res = await readJson(req);
  assert.deepEqual(res, { name: 'Alice', count: 42 });
});

test('readJson rejects oversized payload with 413 error', async () => {
  const largeBody = JSON.stringify({ data: 'x'.repeat(100) });
  const req = createMockReq(largeBody);
  await assert.rejects(
    async () => readJson(req, { maxBytes: 50 }),
    (err: any) => err instanceof RouteKitHttpError && err.status === 413 && err.refusal.code === 'REFUSED'
  );
});

test('readJson rejects invalid JSON with 400 error', async () => {
  const req = createMockReq('{not valid json}');
  await assert.rejects(
    async () => readJson(req),
    (err: any) => err instanceof RouteKitHttpError && err.status === 400 && err.refusal.code === 'REFUSED'
  );
});

test('readJson rejects non-object JSON (array, primitive) with 400 error', async () => {
  const req = createMockReq('["item1","item2"]');
  await assert.rejects(
    async () => readJson(req),
    (err: any) => err instanceof RouteKitHttpError && err.status === 400
  );
});

test('parsePagination returns defaults when params are missing', () => {
  const url = new URL('https://api.local/v1/items');
  const res = parsePagination(url);
  assert.equal(res.limit, 50);
  assert.equal(res.cursor, null);
});

test('parsePagination parses cursor and custom limit within bounds', () => {
  const url = new URL('https://api.local/v1/items?limit=25&cursor=2026-10-24T00:00:00Z');
  const res = parsePagination(url);
  assert.equal(res.limit, 25);
  assert.equal(res.cursor, '2026-10-24T00:00:00Z');
});

test('parsePagination clamps limit to maxLimit', () => {
  const url = new URL('https://api.local/v1/items?limit=500');
  const res = parsePagination(url, { maxLimit: 100 });
  assert.equal(res.limit, 100);
});

test('notFound, badRequest, forbidden return valid Refusal shapes', () => {
  const nf = notFound('trace-1');
  assert.equal(nf.ok, false);
  assert.equal(nf.code, 'REFUSED');
  assert.equal(nf.message, 'not found');

  const br = badRequest('trace-2', 'missing field');
  assert.equal(br.ok, false);
  assert.equal(br.code, 'REFUSED');
  assert.equal(br.message, 'missing field');

  const fb = forbidden('trace-3', 'access denied');
  assert.equal(fb.ok, false);
  assert.equal(fb.code, 'REFUSED');
  assert.equal(fb.message, 'access denied');
});
