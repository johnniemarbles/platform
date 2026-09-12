/**
 * @platform-core/scheduling — neutral client-booking domain (ADR-018).
 *
 * Pure types, state machine, and helpers. Persistence lives in
 * postgres-runtime + infra/db migrations. Pack labels live in industry-packs.
 */

export * from './states.ts';
export * from './types.ts';
