import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Counter,
  Histogram,
  Registry,
  recordGateMetric,
  recordProviderMetric,
  recordSpendBreakerTrip,
  recordDeliveryOutcome,
  recordThrottleRefusal,
  getMetricsRegistry,
} from '../src/metrics.ts';

test('Counter increments and renders Prometheus text', () => {
  const c = new Counter('test_requests_total', 'Test requests.');
  c.inc({ route: 'a' });
  c.inc({ route: 'a' }, 2);
  const text = c.render();
  assert.match(text, /# TYPE test_requests_total counter/);
  assert.match(text, /test_requests_total\{route="a"\} 3/);
});

test('Histogram observes buckets', () => {
  const h = new Histogram('test_latency_seconds', 'Latency.', [0.1, 0.5, 1]);
  h.observe(0.05, { gate: 'X' });
  h.observe(0.4, { gate: 'X' });
  const text = h.render();
  assert.match(text, /test_latency_seconds_count\{gate="X"\} 2/);
  assert.match(text, /le="0.1"/);
  assert.match(text, /le="\+Inf"/);
});

test('Registry includes process uptime', () => {
  const reg = new Registry();
  reg.register(new Counter('noop_total', 'noop'));
  const text = reg.render();
  assert.match(text, /process_uptime_seconds /);
});

test('recordGateMetric writes verdict and latency', () => {
  recordGateMetric({ gate: 'QUOTA_THROTTLE', verdict: 'FAIL', elapsedMs: 12 });
  const text = getMetricsRegistry().render();
  assert.match(text, /expadio_gate_verdicts_total/);
  assert.match(text, /gate="QUOTA_THROTTLE"/);
  assert.match(text, /verdict="FAIL"/);
  assert.match(text, /expadio_gate_latency_seconds/);
});

test('WO-E10-B provider metric sanitizes key and records outcome', () => {
  recordProviderMetric({
    providerKey: 'Twilio SMS!',
    operation: 'SEND',
    outcome: 'success',
    elapsedMs: 120,
  });
  const text = getMetricsRegistry().render();
  assert.match(text, /expadio_provider_operations_total/);
  assert.match(text, /provider_key="twilio_sms_"/);
  assert.match(text, /operation="SEND"/);
  assert.match(text, /outcome="success"/);
  assert.match(text, /expadio_provider_latency_seconds/);
});

test('WO-E10-B spend breaker and delivery and throttle', () => {
  recordSpendBreakerTrip('TRANSACTIONAL');
  recordDeliveryOutcome({ plane: 'marketing', outcome: 'refused' });
  recordThrottleRefusal('MARKETING');
  const text = getMetricsRegistry().render();
  assert.match(text, /expadio_spend_breaker_trips_total\{plane="TRANSACTIONAL"\}/);
  assert.match(text, /expadio_delivery_outcomes_total\{outcome="refused",plane="MARKETING"\}/);
  assert.match(text, /expadio_throttle_refusals_total\{plane="MARKETING"\}/);
});
