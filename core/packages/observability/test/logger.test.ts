import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORRELATION_HEADER,
  correlationIdFrom,
  createLogger,
  isAcceptableCorrelationId,
  logGate,
  requestLogger,
} from '../src/index.ts';

/** Collects the JSON lines a logger writes, so assertions read what shipped. */
function capture(): { lines: Record<string, unknown>[]; destination: { write(chunk: string): void } } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    destination: {
      write(chunk: string) {
        for (const raw of chunk.split('\n')) {
          if (raw.trim() !== '') lines.push(JSON.parse(raw) as Record<string, unknown>);
        }
      },
    },
  };
}

test('a correlation id from the caller is used only if it is safe to use', () => {
  assert.ok(isAcceptableCorrelationId('7f3a91c2-0b5e-4a11-9d2c-8e6f0a1b2c3d'));
  assert.ok(isAcceptableCorrelationId('01JB2K3M4N5P6Q7R8S9T0V1W2X'));
  assert.ok(isAcceptableCorrelationId('trace_abc-123'));

  // The three destinations this value reaches punish three different inputs:
  // a newline forges a second log line, CR splits a response header, and a
  // quote is unwelcome in a database session setting.
  assert.equal(isAcceptableCorrelationId('abc\ndef'), false);
  assert.equal(isAcceptableCorrelationId('abc\r\nSet-Cookie: x=1'), false);
  assert.equal(isAcceptableCorrelationId("abc'; SELECT 1 --"), false);
  assert.equal(isAcceptableCorrelationId('has space'), false);
  assert.equal(isAcceptableCorrelationId('a'.repeat(129)), false);
  assert.equal(isAcceptableCorrelationId(''), false);
  assert.equal(isAcceptableCorrelationId(undefined), false);
});

test('a malformed correlation id is replaced, not refused', () => {
  // Through a bag rather than Headers, because Headers rejects a raw newline
  // itself -- and this function accepts any header-shaped source, which is what
  // a proxy, a parsed envelope or a queue message actually hands it.
  const hostile = { get: (name: string) => (name === CORRELATION_HEADER ? 'bad value\nwith newline' : null) };
  const generated = correlationIdFrom(hostile);

  // Being handed a bad header is a reason not to use the string, not a reason
  // to fail somebody's request -- refusing would make an ignored header into a
  // denial-of-service surface.
  assert.ok(isAcceptableCorrelationId(generated));
  assert.notEqual(generated, 'bad value\nwith newline');

  const good = new Headers({ [CORRELATION_HEADER]: 'caller-supplied-id' });
  assert.equal(correlationIdFrom(good), 'caller-supplied-id');

  const absent = new Headers();
  assert.ok(isAcceptableCorrelationId(correlationIdFrom(absent)));

  // Values Headers does accept but this must not: a space, a quote, a length
  // nobody meant.
  for (const rejected of ['has space', "quote'here", 'a'.repeat(200)]) {
    const bag = { get: (name: string) => (name === CORRELATION_HEADER ? rejected : null) };
    assert.notEqual(correlationIdFrom(bag), rejected);
  }
});

test('every line carries the service and the correlation id', () => {
  const sink = capture();
  const root = createLogger({ service: 'platform-web', level: 'debug', destination: sink.destination });
  requestLogger(root, 'corr-1').info({ step: 'begin' }, 'request_started');

  assert.equal(sink.lines.length, 1);
  const line = sink.lines[0]!;
  assert.equal(line.service, 'platform-web');
  assert.equal(line.correlationId, 'corr-1');
  assert.equal(line.msg, 'request_started');
  // The word rather than the number, so a person grepping gets what they typed.
  assert.equal(line.level, 'info');
  assert.equal(typeof line.time, 'string');
});

test('recipients and credentials never reach a log line', () => {
  const sink = capture();
  const root = createLogger({ service: 'platform-web', level: 'debug', destination: sink.destination });

  root.info({
    recipient: 'someone@example.com',
    to: '+15551234567',
    accessToken: 'live-token',
    input: { email: 'nested@example.com' },
    data: { clientSecret: 'shh' },
    gate: 'CONSENT',
  }, 'attempted');

  const line = JSON.stringify(sink.lines[0]);
  for (const leaked of ['someone@example.com', '+15551234567', 'live-token', 'nested@example.com', 'shh']) {
    assert.ok(!line.includes(leaked), `leaked ${leaked} into the log line`);
  }
  // Redacted by key, so the field is still visibly present and visibly empty --
  // a blank is a better outcome than a missing field nobody notices.
  assert.match(line, /\[redacted\]/);
  // Something that is not sensitive still comes through, or the redaction would
  // be indistinguishable from logging nothing.
  assert.equal(sink.lines[0]!.gate, 'CONSENT');
});

test('a refusal is a warning that names its remediation; a pass is not news', () => {
  const sink = capture();
  const root = createLogger({ service: 'communication', level: 'debug', destination: sink.destination });
  const logger = requestLogger(root, 'corr-2');

  logGate(logger, { gate: 'CONSENT', ordinal: 3, verdict: 'PASS', detail: 'clear', elapsedMs: 4 });
  logGate(logger, {
    gate: 'QUOTA_THROTTLE',
    ordinal: 13,
    verdict: 'FAIL',
    detail: 'minute window exhausted',
    elapsedMs: 9,
    remediation: 'Raise the per-minute limit',
  });

  const [passed, failed] = sink.lines;
  assert.equal(passed!.msg, 'gate_passed');
  assert.equal(passed!.level, 'debug');

  assert.equal(failed!.msg, 'gate_failed');
  assert.equal(failed!.level, 'warn');
  assert.equal(failed!.gate, 'QUOTA_THROTTLE');
  assert.equal(failed!.remediation, 'Raise the per-minute limit');
  // Both carry the correlation id, which is what makes them findable together.
  assert.equal(failed!.correlationId, 'corr-2');
});

test('passes are silent at the default level, so a refusal is what you see', () => {
  const sink = capture();
  const root = createLogger({ service: 'communication', level: 'info', destination: sink.destination });
  const logger = requestLogger(root, 'corr-3');

  logGate(logger, { gate: 'CONSENT', ordinal: 3, verdict: 'PASS', detail: 'clear', elapsedMs: 4 });
  logGate(logger, { gate: 'SUPPRESSION', ordinal: 5, verdict: 'FAIL', detail: 'on a list', elapsedMs: 6 });

  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0]!.msg, 'gate_failed');
});
