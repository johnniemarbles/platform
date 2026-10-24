import { randomUUID } from 'node:crypto';

/**
 * The correlation id: one value that ties a request's logs, its decision trace
 * and its database session together.
 *
 * The platform already carries this idea -- app.correlation_id is a typed
 * database session setting and routes already read the header. What it did not
 * have was any check on the value, and the value arrives from the caller.
 */

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * What a correlation id may contain.
 *
 * Deliberately narrow, because this value has three destinations and each one
 * punishes a different kind of input:
 *
 *   * a log line. A value containing a newline can forge a second log entry,
 *     which is how an attacker writes whatever they like into the record that
 *     an incident is later reconstructed from;
 *   * a Postgres session setting, via set_config;
 *   * a response header, where CR or LF is a header-splitting primitive.
 *
 * Letters, digits, dash and underscore satisfy every producer worth honouring
 * -- UUIDs, ULIDs, trace ids from a gateway -- and none of the above.
 */
const ACCEPTABLE = /^[A-Za-z0-9_-]{1,128}$/;

export function isAcceptableCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && ACCEPTABLE.test(value);
}

/**
 * The correlation id for a request: the caller's if it is usable, ours if not.
 *
 * A rejected value is replaced rather than refused. Being handed a malformed
 * correlation id is not a reason to fail somebody's request -- it is a reason
 * not to use their string. Refusing would turn a header nobody looks at into a
 * denial-of-service surface.
 */
export function correlationIdFrom(
  headers: Headers | { get(name: string): string | null },
): string {
  const supplied = headers.get(CORRELATION_HEADER)?.trim();
  return isAcceptableCorrelationId(supplied) ? supplied : randomUUID();
}
