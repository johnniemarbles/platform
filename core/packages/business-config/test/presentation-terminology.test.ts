import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePresentationTerm,
  validatePresentationTerminology,
  type PresentationTerminologyCatalogue,
} from '../src/index.ts';

const dentalLabels: PresentationTerminologyCatalogue = {
  defaultLocale: 'en-US',
  concepts: [{
    conceptKey: 'appointment',
    labels: [
      { locale: 'en-US', singular: 'Visit', plural: 'Visits' },
      { locale: 'fr-FR', singular: 'Rendez-vous', plural: 'Rendez-vous' },
    ],
    aliases: ['booking', 'consultation'],
  }],
};

test('validates neutral canonical concepts with localized presentation labels', () => {
  assert.deepEqual(
    validatePresentationTerminology(dentalLabels),
    { valid: true, issues: [] },
  );
});

test('resolves presentation text without changing canonical identity', () => {
  assert.deepEqual(
    resolvePresentationTerm(dentalLabels, 'appointment', 'fr-FR', 'SINGULAR'),
    {
      conceptKey: 'appointment',
      locale: 'fr-FR',
      text: 'Rendez-vous',
    },
  );
  assert.deepEqual(
    resolvePresentationTerm(dentalLabels, 'appointment', 'de-DE', 'PLURAL'),
    {
      conceptKey: 'appointment',
      locale: 'en-US',
      text: 'Visits',
    },
  );
});

test('rejects duplicate concepts, locales, aliases, and missing labels', () => {
  const result = validatePresentationTerminology({
    defaultLocale: 'en-US',
    concepts: [
      {
        conceptKey: 'customer',
        labels: [
          { locale: 'en-US', singular: 'Client', plural: 'Clients' },
          { locale: 'EN-us', singular: 'Customer', plural: 'Customers' },
        ],
        aliases: ['buyer', ' Buyer '],
      },
      {
        conceptKey: 'customer',
        labels: [{ locale: 'fr-FR', singular: '', plural: 'Clients' }],
      },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'TERMINOLOGY_LOCALE_DUPLICATE',
      'TERMINOLOGY_ALIAS_DUPLICATE',
      'TERMINOLOGY_CONCEPT_KEY_DUPLICATE',
      'TERMINOLOGY_LABEL_TEXT_REQUIRED',
      'TERMINOLOGY_DEFAULT_LOCALE_LABEL_REQUIRED',
    ]),
  );
});

test('does not resolve aliases as canonical keys', () => {
  assert.equal(
    resolvePresentationTerm(dentalLabels, 'booking', 'en-US', 'SINGULAR'),
    null,
  );
});
