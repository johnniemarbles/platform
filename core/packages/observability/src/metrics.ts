/**
 * WO-E10-A — minimal Prometheus exposition without prom-client.
 *
 * Process-local counters and histograms; suitable for single-instance scrape.
 * Multi-replica aggregation is the scraper's job (Prometheus / Grafana Cloud).
 *
 * Label cardinality: prefer low-cardinality labels (gate, verdict, plane).
 * Do **not** label on tenant_id or correlation_id.
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

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

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

  constructor(
    readonly name: string,
    readonly help: string,
    buckets: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ) {
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

/** Shared process registry for platform-web (and tests). */
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
