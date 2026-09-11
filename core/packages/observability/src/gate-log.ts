import type { Logger } from './logger.ts';

/**
 * One enforcement gate's outcome, as a log line.
 *
 * Shaped from what the decision trace already records rather than invented
 * alongside it. The trace is the durable record; these lines are the live one,
 * and they carry the same fields so an incident reconstructed from logs and one
 * reconstructed from traces cannot disagree.
 */
export interface GateLogInput {
  readonly gate: string;
  readonly ordinal: number;
  readonly verdict: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly detail: string;
  readonly elapsedMs: number;
  readonly remediation?: string;
}

/**
 * Levels chosen rather than defaulted.
 *
 * A refusal is the event worth keeping, so FAIL is a warning: it is what a
 * tenant is asking about when they say "my send was refused", and it names the
 * gate and the remediation that answers them. It is not an error -- the system
 * did exactly what it is for.
 *
 * A gate that passed is not news. Fifteen info lines per message is how signal
 * and a log bill are lost at the same time, and the full gate-by-gate record is
 * already durably in the decision trace for anyone who wants it. So passes go
 * to debug, where a deployment can turn them on for an afternoon by moving
 * LOG_LEVEL and turn them off again without a release.
 *
 * The detail string is written by the spine, never by a caller, which is why it
 * can be logged as-is. Anything recipient-shaped is redacted by the logger
 * regardless.
 */
export function logGate(logger: Logger, input: GateLogInput): void {
  const line = {
    gate: input.gate,
    ordinal: input.ordinal,
    verdict: input.verdict,
    detail: input.detail,
    elapsedMs: input.elapsedMs,
    ...(input.remediation !== undefined ? { remediation: input.remediation } : {}),
  };

  if (input.verdict === 'FAIL') {
    logger.warn(line, 'gate_failed');
    return;
  }
  if (input.verdict === 'PASS') {
    logger.debug(line, 'gate_passed');
    return;
  }
  logger.debug(line, 'gate_not_evaluated');
}
