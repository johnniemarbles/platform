/**
 * WO-E10 — minimal Prometheus exposition without prom-client.
 *
 * Process-local counters and histograms; suitable for single-instance scrape.
 * Multi-replica aggregation is the scraper's job (Prometheus / Grafana Cloud).
 *
 * Label cardinality: prefer low-cardinality labels (gate, verdict, plane,
 * provider_key, operation, outcome). Do **not** label on tenant_id or
 * correlation_id.
 */

export type MetricLabels = Readonly<Record<string, string>>;

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`).join(',')}}`;
}

function labelsKey(labels: MetricLabels): string {
  return JSON.stringify(
    Object.keys(labels)
      .sort()
      .map((k) => [k, labels[k]]),
  );
}

export class Counter {
  private readonly values = new Map<string, { labels: MetricLabels; value: number }>();

  readonly name: string;
  readonly help: string;

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: MetricLabels = {}, by = 1): void {
    const key = labelsKey(labels);
    const row = this.values.get(key);
    if (row) row.value += by;
    else this.values.set(key, { labels, value: by });
  }

  get(labels: MetricLabels = {}): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const row of this.values.values()) {
      lines.push(`${this.name}${formatLabels(row.labels)} ${row.value}`);
    }
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    return lines.join('\n');
  }
}

/** Fixed-bucket histogram (seconds). */
export class Histogram {
  private readonly buckets: readonly number[];
  private readonly series = new Map<
    string,
    { labels: MetricLabels; counts: number[]; sum: number; count: number }
  >();

  readonly name: string;
  readonly help: string;

  constructor(name: string, help: string, buckets: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name;
    this.help = help;

    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(seconds: number, labels: MetricLabels = {}): void {
    const key = labelsKey(labels);
    let row = this.series.get(key);
    if (!row) {
      row = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, row);
    }
    row.sum += seconds;
    row.count += 1;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (seconds <= this.buckets[i]!) row.counts[i]! += 1;
    }
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const row of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i += 1) {
        cumulative += row.counts[i]!;
        const le = this.buckets[i]!;
        lines.push(
          `${this.name}_bucket${formatLabels({ ...row.labels, le: String(le) })} ${cumulative}`,
        );
      }
      lines.push(
        `${this.name}_bucket${formatLabels({ ...row.labels, le: '+Inf' })} ${row.count}`,
      );
      lines.push(`${this.name}_sum${formatLabels(row.labels)} ${row.sum}`);
      lines.push(`${this.name}_count${formatLabels(row.labels)} ${row.count}`);
    }
    return lines.join('\n');
  }
}

export class Registry {
  private readonly collectors: Array<{ render(): string }> = [];

  register<T extends { render(): string }>(collector: T): T {
    this.collectors.push(collector);
    return collector;
  }

  render(): string {
    const body = this.collectors.map((c) => c.render()).filter((s) => s.length > 0);
    body.push(`# HELP process_uptime_seconds Process uptime in seconds.`);
    body.push(`# TYPE process_uptime_seconds gauge`);
    body.push(`process_uptime_seconds ${process.uptime()}`);
    return `${body.join('\n\n')}\n`;
  }
}

/** Shared process registry for platform-web / brand-web (and tests). */
declare global {
  // eslint-disable-next-line no-var
  var _expadioMetricsRegistry: Registry | undefined;
}

export function getMetricsRegistry(): Registry {
  if (!globalThis._expadioMetricsRegistry) {
    globalThis._expadioMetricsRegistry = new Registry();
  }
  return globalThis._expadioMetricsRegistry;
}

// --- E10-A: gates -----------------------------------------------------------------

let gateVerdicts: Counter | undefined;
let gateLatency: Histogram | undefined;

export function gateVerdictCounter(): Counter {
  if (!gateVerdicts) {
    gateVerdicts = getMetricsRegistry().register(
      new Counter(
        'expadio_gate_verdicts_total',
        'Enforcement gate outcomes by gate name and verdict.',
      ),
    );
  }
  return gateVerdicts;
}

export function gateLatencyHistogram(): Histogram {
  if (!gateLatency) {
    gateLatency = getMetricsRegistry().register(
      new Histogram(
        'expadio_gate_latency_seconds',
        'Enforcement gate latency in seconds.',
      ),
    );
  }
  return gateLatency;
}

/** Record one gate outcome (call from DecisionTrace observer / logGate). */
export function recordGateMetric(input: {
  readonly gate: string;
  readonly verdict: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly elapsedMs: number;
}): void {
  if (input.verdict === 'NOT_EVALUATED') return;
  gateVerdictCounter().inc({ gate: input.gate, verdict: input.verdict });
  gateLatencyHistogram().observe(input.elapsedMs / 1000, { gate: input.gate });
}

// --- E10-B: provider / spend / delivery ---------------------------------------------

let providerOps: Counter | undefined;
let providerLatency: Histogram | undefined;
let spendBreakerTrips: Counter | undefined;
let deliveryOutcomes: Counter | undefined;
let throttleRefusals: Counter | undefined;

function sanitizeProviderKey(providerKey: string): string {
  const cleaned = providerKey.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return cleaned.slice(0, 64) || 'unknown';
}

export function providerOpsCounter(): Counter {
  if (!providerOps) {
    providerOps = getMetricsRegistry().register(
      new Counter(
        'expadio_provider_operations_total',
        'Provider API operations by provider, operation, and outcome.',
      ),
    );
  }
  return providerOps;
}

export function providerLatencyHistogram(): Histogram {
  if (!providerLatency) {
    providerLatency = getMetricsRegistry().register(
      new Histogram(
        'expadio_provider_latency_seconds',
        'Provider API latency in seconds.',
        [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      ),
    );
  }
  return providerLatency;
}

/**
 * Record a provider probe or send.
 * Labels: provider_key (sanitized), operation (PROBE|SEND|…), outcome (success|failure).
 */
export function recordProviderMetric(input: {
  readonly providerKey: string;
  readonly operation: 'PROBE' | 'SEND' | 'WRAP' | 'OTHER';
  readonly outcome: 'success' | 'failure';
  readonly elapsedMs: number;
}): void {
  const provider_key = sanitizeProviderKey(input.providerKey);
  const labels = {
    provider_key,
    operation: input.operation,
    outcome: input.outcome,
  };
  providerOpsCounter().inc(labels);
  providerLatencyHistogram().observe(input.elapsedMs / 1000, {
    provider_key,
    operation: input.operation,
  });
}

export function spendBreakerCounter(): Counter {
  if (!spendBreakerTrips) {
    spendBreakerTrips = getMetricsRegistry().register(
      new Counter(
        'expadio_spend_breaker_trips_total',
        'Spend breaker open events by plane.',
      ),
    );
  }
  return spendBreakerTrips;
}

/** Plane: TRANSACTIONAL | MARKETING | SYSTEM (or OTHER). */
export function recordSpendBreakerTrip(plane: string): void {
  const p = plane.trim().toUpperCase() || 'OTHER';
  spendBreakerCounter().inc({ plane: p.slice(0, 32) });
}

export function deliveryOutcomeCounter(): Counter {
  if (!deliveryOutcomes) {
    deliveryOutcomes = getMetricsRegistry().register(
      new Counter(
        'expadio_delivery_outcomes_total',
        'Message delivery outcomes by plane and outcome.',
      ),
    );
  }
  return deliveryOutcomes;
}

export function recordDeliveryOutcome(input: {
  readonly plane: string;
  readonly outcome: 'sent' | 'queued' | 'refused' | 'cancelled' | 'failed';
}): void {
  const plane = (input.plane.trim().toUpperCase() || 'OTHER').slice(0, 32);
  deliveryOutcomeCounter().inc({ plane, outcome: input.outcome });
}

export function throttleRefusalCounter(): Counter {
  if (!throttleRefusals) {
    throttleRefusals = getMetricsRegistry().register(
      new Counter(
        'expadio_throttle_refusals_total',
        'Gate-13 throttle refusals by plane.',
      ),
    );
  }
  return throttleRefusals;
}

export function recordThrottleRefusal(plane: string): void {
  const p = (plane.trim().toUpperCase() || 'OTHER').slice(0, 32);
  throttleRefusalCounter().inc({ plane: p });
}

// --- WO-GTM-E/F/G/I + UX: GTM domain boundaries (no tenant labels) ------------------

export type GtmMetricOperation =
  | 'sequence_draft'
  | 'icp_proposal'
  | 'dispatch_claim'
  | 'dispatch_approve'
  | 'dispatch_reject'
  | 'campaign_draft'
  | 'enrollment'
  | 'enrollment_pause'
  | 'enrollment_resume'
  | 'enrollment_abort'
  | 'enrollment_complete'
  | 'enrollment_advance'
  | 'reply_convert_lead'
  | 'optimize_propose'
  | 'optimize_review'
  | 'starter_pack_apply';

export type GtmMetricOutcome = 'success' | 'validation_error' | 'conflict' | 'failure';

let gtmOperations: Counter | undefined;

export function gtmOperationsCounter(): Counter {
  if (!gtmOperations) {
    gtmOperations = getMetricsRegistry().register(
      new Counter(
        'expadio_gtm_operations_total',
        'GTM product operations by operation and outcome (no tenant labels).',
      ),
    );
  }
  return gtmOperations;
}

/**
 * Record a GTM boundary action (draft, claim, convert, review, etc.).
 * Does not imply provider send — GTM remains observation / intent only.
 */
export function recordGtmOperation(input: {
  readonly operation: GtmMetricOperation;
  readonly outcome: GtmMetricOutcome;
}): void {
  gtmOperationsCounter().inc({
    operation: input.operation,
    outcome: input.outcome,
  });
}
