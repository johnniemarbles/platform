/**
 * @platform-core/lead-identity
 *
 * Pure identity resolution for Demand Capture: deterministic normalization,
 * transparent match scoring, and safe merge planning. No database or network.
 *
 * The guardrail this package exists to enforce: only an exact normalized-email
 * match auto-links; every weaker signal is queued for human review; merges are
 * always reversible and never cross an organization.
 */
export * from './normalize.ts';
export * from './match.ts';
export * from './merge.ts';
