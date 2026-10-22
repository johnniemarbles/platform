/**
 * @platform-core/entity
 *
 * Domain contracts for the entity graph: typed nodes, governed relationship
 * edges, legal overlays, location units, and ownership interests.
 *
 * This package contains ONLY pure TypeScript — no database client, no HTTP
 * client, no filesystem access. A CI test asserts that (design constraint:
 * domain logic must be testable without infrastructure).
 *
 * The six relationship types and eight node types defined here mirror the
 * CHECK constraints in migrations 0120–0121. If you add a type here, add it
 * to the migration constraint and vice versa. The domain and the database
 * must agree; a type accepted in one but rejected in the other is a runtime
 * error waiting for production to find it.
 */

export * from './node.ts';
export * from './relationship.ts';
export * from './legal-entity.ts';
export * from './location-unit.ts';
export * from './ownership-interest.ts';
export * from './closure.ts';
export * from './genesis.ts';
export * from './errors.ts';
export * from './governance-policy.ts';
