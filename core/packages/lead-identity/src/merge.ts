/**
 * Merge planning + invariants. Pure: decides the survivor and which fields win;
 * the caller performs the writes and records reversible evidence. A merge is
 * always reversible (status flip + relink), so duplicates are retained, never
 * destroyed.
 */

export interface MergeableContact {
  readonly contactId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly status: 'ACTIVE' | 'MERGED';
  readonly createdAt: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
}

export class MergeInvariantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MergeInvariantError';
    this.code = code;
  }
}

export interface MergePlan {
  readonly survivorContactId: string;
  readonly mergedContactId: string;
  /** Fields the survivor should adopt from the merged record (fill-the-blanks). */
  readonly fieldUpdates: Readonly<Record<string, string>>;
}

function fill(target: string | null | undefined, fallback: string | null | undefined): string | null {
  const t = typeof target === 'string' ? target.trim() : '';
  if (t !== '') return null; // survivor already has a value; keep it.
  const f = typeof fallback === 'string' ? fallback.trim() : '';
  return f === '' ? null : f;
}

/**
 * Plan a merge of `duplicate` into `survivor`. The survivor is the older ACTIVE
 * record; its non-empty fields always win, and the duplicate only fills blanks.
 * Refuses to cross organizations, merge a record into itself, or touch an
 * already-merged record — those are integrity violations, not judgment calls.
 */
export function planContactMerge(survivor: MergeableContact, duplicate: MergeableContact): MergePlan {
  if (survivor.contactId === duplicate.contactId) {
    throw new MergeInvariantError('MERGE_SELF', 'A contact cannot be merged into itself.');
  }
  if (survivor.tenantId !== duplicate.tenantId || survivor.organizationId !== duplicate.organizationId) {
    throw new MergeInvariantError('MERGE_CROSS_SCOPE', 'Contacts in different organizations cannot be merged.');
  }
  if (survivor.status !== 'ACTIVE' || duplicate.status !== 'ACTIVE') {
    throw new MergeInvariantError('MERGE_NOT_ACTIVE', 'Only two active contacts can be merged.');
  }
  const fieldUpdates: Record<string, string> = {};
  const email = fill(survivor.email, duplicate.email);
  const phone = fill(survivor.phone, duplicate.phone);
  const firstName = fill(survivor.firstName, duplicate.firstName);
  const lastName = fill(survivor.lastName, duplicate.lastName);
  if (email) fieldUpdates.email = email;
  if (phone) fieldUpdates.phone = phone;
  if (firstName) fieldUpdates.firstName = firstName;
  if (lastName) fieldUpdates.lastName = lastName;
  return { survivorContactId: survivor.contactId, mergedContactId: duplicate.contactId, fieldUpdates };
}

/** The survivor is the older record; ties break on contactId for determinism. */
export function chooseSurvivor(a: MergeableContact, b: MergeableContact): { survivor: MergeableContact; duplicate: MergeableContact } {
  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  if (aTime !== bTime) return aTime < bTime ? { survivor: a, duplicate: b } : { survivor: b, duplicate: a };
  return a.contactId <= b.contactId ? { survivor: a, duplicate: b } : { survivor: b, duplicate: a };
}
