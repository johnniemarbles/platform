import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from '../../../apps/platform-api/test/helpers/harness.ts';
import type { Transport } from '@platform-sdk/transport';
import { assertShape } from '../../transport/src/test-utils.ts';
import { directoryClient } from '../src/index.ts';

test('directory sdk: contract tests against real platform-api for listings, external upsert, claims, and featured slots', async () => {
  const harness = await setupHarness('dentex');
  const owner = await harness.asRole('owner');

  const transport: Transport = {
    async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      const res = await owner.request(method, path, body);
      if (res.status >= 400) {
        throw new Error(`request failed with status ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return res.body.result;
    },
  };

  const client = directoryClient(transport);

  // 1. Create listing
  const listing = await client.listings.create({
    kind: 'clinic',
    name: 'Mission Dental Arts',
    city: 'San Francisco',
    addressLine: '1234 Mission St',
    country: 'US',
    latitude: 37.7749,
    longitude: -122.4194,
    phone: '+14155550199',
    attributes: { services: ['cleaning', 'invisalign'], rating: 4.9 },
  });
  assertShape(listing, {
    listingId: 'string',
    tenantId: 'string',
    appId: 'string',
    kind: 'string',
    name: 'string',
    slug: 'string',
    status: 'string',
    claimStatus: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  });
  assert.equal(listing.name, 'Mission Dental Arts');
  assert.equal(listing.slug, 'mission-dental-arts');
  assert.equal(listing.claimStatus, 'UNCLAIMED');

  // 2. List listings
  const listingsList = await client.listings.list({ kind: 'clinic', city: 'San Francisco' });
  assert.ok(listingsList.items.some((l) => l.listingId === listing.listingId));

  // 3. Update listing
  const updatedListing = await client.listings.update(listing.listingId, { phone: '+14155550200' });
  assert.equal(updatedListing.phone, '+14155550200');

  // 4. External ref upsert (Google Places style)
  const placeListing = await client.listings.create({
    kind: 'clinic',
    name: 'SoMa Smiles',
    city: 'San Francisco',
    externalProvider: 'google_places',
    externalRef: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  });
  assert.equal(placeListing.name, 'SoMa Smiles');

  // Upsert with modified address
  const reUpserted = await client.listings.create({
    kind: 'clinic',
    name: 'SoMa Smiles & Ortho',
    city: 'San Francisco',
    addressLine: '500 Howard St',
    externalProvider: 'google_places',
    externalRef: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  });
  assert.equal(reUpserted.listingId, placeListing.listingId, 'Upsert must match existing listing');
  assert.equal(reUpserted.name, 'SoMa Smiles & Ortho');
  assert.equal(reUpserted.addressLine, '500 Howard St');

  // 5. Claim workflow: Initiate claim
  const claimedListing = await client.listings.claim(listing.listingId);
  assert.equal(claimedListing.claimStatus, 'PENDING');

  // Decide claim: approve
  const approvedListing = await client.listings.decideClaim(listing.listingId, { approve: true });
  assert.equal(approvedListing.claimStatus, 'CLAIMED');

  // 6. Featured slots
  const now = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const featured = await client.featured.create({
    listingId: listing.listingId,
    placement: 'home_hero',
    startsOn: now.toISOString().slice(0, 10),
    endsOn: tomorrow.toISOString().slice(0, 10),
  });
  assertShape(featured, {
    slotId: 'string',
    tenantId: 'string',
    appId: 'string',
    listingId: 'string',
    placement: 'string',
    startsOn: 'string',
    endsOn: 'string',
    createdAt: 'string',
  });
  assert.equal(featured.placement, 'home_hero');
  assert.equal(featured.isActive, true);

  const featuredList = await client.featured.list({ placement: 'home_hero' });
  assert.ok(featuredList.items.some((f) => f.slotId === featured.slotId));
  const slotItem = featuredList.items.find((f) => f.slotId === featured.slotId)!;
  assert.equal(slotItem.listingName, 'Mission Dental Arts');

  // 7. Archive listing
  const archiveRes = await client.listings.archive(listing.listingId);
  assert.equal(archiveRes.archived, true);

  const afterArchive = await client.listings.get(listing.listingId);
  assert.equal(afterArchive.status, 'ARCHIVED');

  await harness.close();
});
