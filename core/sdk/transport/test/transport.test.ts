import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, PlatformApiError } from '../src/index.ts';
import { assertShape } from '../src/test-utils.ts';

test('transport: buildQuery handles diverse types and omits empty/null/undefined', () => {
  const query = buildQuery({
    str: 'hello',
    num: 42,
    bool: true,
    empty: '',
    nullVal: null,
    undefVal: undefined,
  });
  assert.equal(query, '?str=hello&num=42&bool=true');
  assert.equal(buildQuery({}), '');
});

test('transport: PlatformApiError contains code and traceId', () => {
  const err = new PlatformApiError('ERR_CODE', 'trace-123', 'custom message');
  assert.equal(err.code, 'ERR_CODE');
  assert.equal(err.traceId, 'trace-123');
  assert.equal(err.message, 'custom message');
  assert.equal(err.name, 'PlatformApiError');
});

test('transport: assertShape passes on valid objects and throws on mismatches', () => {
  assertShape(
    { name: 'John', age: 30, active: true, tags: ['a'], meta: { k: 'v' } },
    { name: 'string', age: 'number', active: 'boolean', tags: 'array', meta: 'object' }
  );

  assert.throws(() => {
    assertShape({ name: 123 }, { name: 'string' });
  });
});
