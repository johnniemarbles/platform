import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LearningInteroperabilityValidationError,
  validateLearningInteroperabilityPackageRegistration,
} from '../src/interoperability.ts';

const assetId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

test('SCORM package registration binds to governed content assets', () => {
  const registration = validateLearningInteroperabilityPackageRegistration({
    packageKey: 'safety.scorm',
    standard: 'SCORM_2004',
    title: 'Safety SCORM package',
    assetId,
    metadata: { manifest: 'imsmanifest.xml' },
  });

  assert.equal(registration.standard, 'SCORM_2004');
  assert.equal(registration.assetId, assetId);
  assert.equal(registration.launchUrl, null);
  assert.equal(registration.xapiActivityId, null);
});

test('LTI and xAPI registrations require standard-specific launch identity', () => {
  const lti = validateLearningInteroperabilityPackageRegistration({
    packageKey: 'lab.vendor.tool',
    standard: 'LTI_1_3',
    title: 'External lab',
    launchUrl: 'https://lti.example.com/launch',
  });
  assert.equal(lti.launchUrl, 'https://lti.example.com/launch');

  const xapi = validateLearningInteroperabilityPackageRegistration({
    packageKey: 'flight.simulator',
    standard: 'XAPI',
    title: 'Flight simulator',
    xapiActivityId: 'urn:expadio:learning:activity:flight-simulator',
  });
  assert.equal(xapi.xapiActivityId, 'urn:expadio:learning:activity:flight-simulator');
});

test('interoperability registration refuses cross-standard authority and secrets', () => {
  assert.throws(
    () => validateLearningInteroperabilityPackageRegistration({
      packageKey: 'bad.scorm',
      standard: 'SCORM_1_2',
      title: 'Bad package',
      launchUrl: 'https://example.com/launch',
    }),
    (error: unknown) => error instanceof LearningInteroperabilityValidationError
      && error.code === 'SCORM_ASSET_REQUIRED',
  );

  assert.throws(
    () => validateLearningInteroperabilityPackageRegistration({
      packageKey: 'bad.lti',
      standard: 'LTI_1_3',
      title: 'Bad tool',
      launchUrl: 'http://example.com/launch',
    }),
    (error: unknown) => error instanceof LearningInteroperabilityValidationError
      && error.code === 'UNSAFE_URL',
  );

  assert.throws(
    () => validateLearningInteroperabilityPackageRegistration({
      packageKey: 'bad.secret',
      standard: 'XAPI',
      title: 'Secret-bearing package',
      xapiActivityId: 'https://example.com/activity',
      metadata: { provider: { apiKey: 'never-store-provider-tokens-here' } },
    }),
    (error: unknown) => error instanceof LearningInteroperabilityValidationError
      && error.code === 'RESERVED_METADATA_KEY',
  );
});
