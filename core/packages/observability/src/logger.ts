import { pino, type Logger as PinoLogger } from 'pino';

/**
 * Structured logging, as JSON on stdout, which is what Railway collects.
 *
 * The platform has had correlation ids for a long time and nothing that wrote
 * them anywhere. Refusals were reported to the caller and then lost: a tenant
 * saying "my send was refused" left nobody anything to search. This is the
 * thing that writes them down.
 *
 * No transports, no worker threads, no files. A route handler writing a line to
 * stdout is the whole mechanism, which is also what keeps it bundlable inside
 * Next and cheap enough to leave on.
 */

/**
 * Field names that must never reach a log line, wherever they appear.
 *
 * Redaction is by key rather than by value, on the theory that the cost of
 * losing a field to caution is a blank in a log and the cost of missing one is
 * a recipient's address sitting in a log aggregator forever.
 *
 * These are paths into the merged object. The wildcards cover the shapes the
 * codebase actually produces -- a flat object, an `input`/`payload` wrapper, or
 * anything one level down -- rather than every conceivable nesting, because a
 * redaction list nobody can read is one nobody maintains.
 */
const REDACTED_KEYS = [
  'recipient',
  'recipientAddress',
  'to',
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'address',
  'accessToken',
  'refreshToken',
  'token',
  'secret',
  'password',
  'authorization',
  'apiKey',
  'clientSecret',
  'codeVerifier',
] as const;

function redactionPaths(): string[] {
  const paths: string[] = [];
  for (const key of REDACTED_KEYS) {
    paths.push(key, `*.${key}`, `input.${key}`, `payload.${key}`, `data.${key}`);
  }
  // Header bags, which carry bearer tokens and cookies by definition.
  paths.push('headers.authorization', 'headers.cookie', 'req.headers.authorization');
  return paths;
}

export interface LoggerOptions {
  /** Which service is speaking. Appears on every line. */
  readonly service: string;
  readonly level?: string;
  /** Where the lines go. Injected so tests can read them. */
  readonly destination?: { write(chunk: string): void };
}

export type Logger = PinoLogger;

/**
 * Builds the root logger for a service.
 *
 * The level comes from LOG_LEVEL so a deployment can turn detail up without a
 * release, and defaults to info -- debug in production is how a log bill and a
 * PII surface both grow without anybody deciding to.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? 'info',
      base: {
        service: options.service,
        env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'development',
      },
      // Milliseconds since epoch is what every aggregator parses without being
      // told; pino's default is the same, stated here so it is not accidental.
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: redactionPaths(), censor: '[redacted]' },
      formatters: {
        // The word, not the number. A log a person greps should say "error".
        level: (label) => ({ level: label }),
      },
    },
    options.destination as never,
  );
}

/**
 * A logger bound to one request.
 *
 * Every line it writes carries the correlation id, which is the same value the
 * decision trace records and the response header returns -- so "show me
 * everything about this send" is one query rather than a reconstruction.
 */
export function requestLogger(root: Logger, correlationId: string): Logger {
  return root.child({ correlationId });
}
