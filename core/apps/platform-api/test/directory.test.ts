import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from './helpers/harness.ts';

test('directory module: permission denial, cross-tenant, cross-app isolation, upsert, claims, and featured windows', async () => {
  const harness = await setupHarness('dentex');
  const owner = await harness.asRole('owner');
  const staff = await harness.asRole('staff');
  const viewer = await harness.asRole('viewer');
  const tenant2Owner = await harness.asTenant('tenant-b', 'owner');
  const otherAppCaller = await harness.asOtherApp('tress-lounge');

  // 1. Permission denial
  // Viewer cannot create listings
  const viewerCreate = await viewer.request('POST', '/v1/directory/listings', {
    kind: 'clinic',
    name: 'Unauthorized Clinic',
  });
  assert.equal(viewerCreate.status, 403);
  assert.equal(viewerCreate.body.code, 'TOKEN_SCOPE_MISMATCH');

  // 2. Create listing as Owner
  const createRes = await owner.request('POST', '/v1/directory/listings', {
    kind: 'clinic',
    name: 'Dentex Premier Clinic',
    city: 'Seattle',
    addressLine: '100 Pike St',
    country: 'US',
    phone: '+12065550100',
    attributes: { services: ['implants', 'veneers'], rating: 4.9 },
  });
  assert.equal(createRes.status, 200);
  const listing = createRes.body.result;
  assert.equal(listing.name, 'Dentex Premier Clinic');
  assert.equal(listing.slug, 'dentex-premier-clinic');
  assert.equal(listing.claimStatus, 'UNCLAIMED');

  // Staff can create listing (has directory.staff bundle)
  const staffCreate = await staff.request('POST', '/v1/directory/listings', {
    kind: 'clinic',
    name: 'Dentex North Clinic',
    city: 'Seattle',
  });
  assert.equal(staffCreate.status, 200);
  const staffListing = staffCreate.body.result;

  // Staff CANNOT decide claim (needs directory.listing.manage in manager bundle)
  const staffClaimDecision = await staff.request(
    'POST',
    `/v1/directory/listings/${staffListing.listingId}/claim/decision`,
    { approve: true }
  );
  assert.equal(staffClaimDecision.status, 403);
  assert.equal(staffClaimDecision.body.code, 'TOKEN_SCOPE_MISMATCH');

  // Staff CANNOT manage featured slots (needs directory.featured.manage)
  const staffFeatured = await staff.request('POST', '/v1/directory/featured', {
    listingId: staffListing.listingId,
    placement: 'homepage',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
  });
  assert.equal(staffFeatured.status, 403);
  assert.equal(staffFeatured.body.code, 'TOKEN_SCOPE_MISMATCH');

  // 3. Cross-tenant isolation (Tenant B cannot read Tenant A's listing)
  const crossTenantGet = await tenant2Owner.request('GET', `/v1/directory/listings/${listing.listingId}`);
  assert.equal(crossTenantGet.status, 404);
  assert.equal(crossTenantGet.body.code, 'REFUSED');

  // 4. Cross-app isolation (Other app tress-lounge in same tenant cannot read Dentex listing)
  const tressMRes = await harness.pg.query<{ membership_id: string; person_id: string }>(
    "SELECT membership_id, person_id FROM platform.memberships WHERE identity_subject_id = 'usr_other_tress-lounge'"
  );
  if (tressMRes.rows[0]) {
    await harness.pg.query(
      `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
       VALUES ($1, 'app_tress_lounge', 'owner', ARRAY['directory.listing.read', 'directory.listing.write'], 'root', $2)`,
      [tressMRes.rows[0].membership_id, tressMRes.rows[0].person_id]
    );
  }

  const crossAppGet = await otherAppCaller.request('GET', `/v1/directory/listings/${listing.listingId}`);
  assert.equal(crossAppGet.status, 404);
  assert.equal(crossAppGet.body.code, 'REFUSED');

  // 5. External-ref upsert idempotency
  const ext1 = await owner.request('POST', '/v1/directory/listings', {
    kind: 'clinic',
    name: 'Google Place Clinic',
    city: 'Seattle',
    externalProvider: 'google_places',
    externalRef: 'place_abc_123',
  });
  assert.equal(ext1.status, 200);
  const extListingId = ext1.body.result.listingId;

  // Re-posting with updated phone must update the same row
  const ext2 = await owner.request('POST', '/v1/directory/listings', {
    kind: 'clinic',
    name: 'Google Place Clinic Renamed',
    city: 'Seattle',
    phone: '+12065559999',
    externalProvider: 'google_places',
    externalRef: 'place_abc_123',
  });
  assert.equal(ext2.status, 200);
  assert.equal(ext2.body.result.listingId, extListingId);
  assert.equal(ext2.body.result.name, 'Google Place Clinic Renamed');
  assert.equal(ext2.body.result.phone, '+12065559999');

  // 6. Claim workflow: claim, reject, claim, approve
  const claimRes = await staff.request('POST', `/v1/directory/listings/${listing.listingId}/claim`);
  assert.equal(claimRes.status, 200);
  assert.equal(claimRes.body.result.claimStatus, 'PENDING');
  assert.ok(claimRes.body.result.ownerPersonId);

  // Reject claim
  const rejectRes = await owner.request(
    'POST',
    `/v1/directory/listings/${listing.listingId}/claim/decision`,
    { approve: false }
  );
  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.result.claimStatus, 'UNCLAIMED');
  assert.equal(rejectRes.body.result.ownerPersonId, null);

  // Re-claim & Approve
  await staff.request('POST', `/v1/directory/listings/${listing.listingId}/claim`);
  const approveRes = await owner.request(
    'POST',
    `/v1/directory/listings/${listing.listingId}/claim/decision`,
    { approve: true }
  );
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.result.claimStatus, 'CLAIMED');

  // 7. Featured window queries
  const featuredPast = await owner.request('POST', '/v1/directory/featured', {
    listingId: listing.listingId,
    placement: 'hero_spot',
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
  });
  assert.equal(featuredPast.status, 200);

  const featuredCurrent = await owner.request('POST', '/v1/directory/featured', {
    listingId: listing.listingId,
    placement: 'hero_spot',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
  });
  assert.equal(featuredCurrent.status, 200);

  // Query on 2026-10-15 should find current, not past
  const currentQuery = await owner.request(
    'GET',
    '/v1/directory/featured?placement=hero_spot&on=2026-10-15'
  );
  assert.equal(currentQuery.status, 200);
  assert.equal(currentQuery.body.result.items.length, 1);
  assert.equal(currentQuery.body.result.items[0].slotId, featuredCurrent.body.result.slotId);

  // Query on 2026-01-15 should find past, not current
  const pastQuery = await owner.request(
    'GET',
    '/v1/directory/featured?placement=hero_spot&on=2026-01-15'
  );
  assert.equal(pastQuery.status, 200);
  assert.equal(pastQuery.body.result.items.length, 1);
  assert.equal(pastQuery.body.result.items[0].slotId, featuredPast.body.result.slotId);

  await harness.close();
});
