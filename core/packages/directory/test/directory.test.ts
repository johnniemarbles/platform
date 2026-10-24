import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  validateListingInput,
  validateAttributes,
  DirectoryValidationError,
  type KindSchema,
} from '../src/index.ts';

test('directory: slugify transforms name properly', () => {
  assert.equal(slugify('Central Dental Care'), 'central-dental-care');
  assert.equal(slugify('  L’Oréal Salon & Spa!  '), 'l-oreal-salon-spa');
  assert.equal(slugify(''), 'listing');
});

test('directory: validateListingInput enforces schema rules', () => {
  const valid = validateListingInput({
    kind: 'clinic',
    name: 'Bay Area Orthodontics',
    city: 'San Francisco',
    country: 'US',
    latitude: 37.7749,
    longitude: -122.4194,
  });
  assert.equal(valid.kind, 'clinic');
  assert.equal(valid.slug, 'bay-area-orthodontics');
  assert.equal(valid.country, 'US');

  // External provider pair requirement
  assert.throws(
    () => validateListingInput({ kind: 'clinic', name: 'Test', externalProvider: 'google_places' }),
    DirectoryValidationError
  );

  // Invalid kind regex
  assert.throws(
    () => validateListingInput({ kind: 'Invalid-Kind', name: 'Test' }),
    DirectoryValidationError
  );
});

test('directory: validateAttributes checks kind schema against attributes', () => {
  const registry: Record<string, KindSchema> = {
    clinic: {
      properties: {
        services: { type: 'string[]', required: true },
        rating: { type: 'number', required: false },
        acceptsEmergency: { type: 'boolean', required: false },
      },
    },
  };

  const ok = validateAttributes('clinic', { services: ['cleaning', 'whitening'], rating: 4.8 }, registry);
  assert.equal(ok.valid, true);

  const missingReq = validateAttributes('clinic', { rating: 5 }, registry);
  assert.equal(missingReq.valid, false);
  assert.ok(missingReq.errors[0]?.includes('missing required attribute: services'));

  const wrongType = validateAttributes('clinic', { services: [123] }, registry);
  assert.equal(wrongType.valid, false);
  assert.ok(wrongType.errors[0]?.includes('must be an array of strings'));
});
