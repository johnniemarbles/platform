import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateLeadInput,
  validateStage,
  isClosedStage,
  isAcceptedLeadSource,
  LeadValidationError,
  LEAD_STAGES,
  OUTBOUND_GTM_LEAD_SOURCE,
  DEMAND_CAPTURE_LEAD_SOURCE,
  mapCaptureStageToCrm,
  buildCrmLeadFromCapture,
} from '../src/index.ts';

test('a valid lead defaults stage/currency and keeps amount', () => {
  const lead = validateLeadInput({ title: '  Big deal ', amountMinorUnits: 500000 });
  assert.equal(lead.title, 'Big deal');
  assert.equal(lead.stage, 'NEW');
  assert.equal(lead.currency, 'USD');
  assert.equal(lead.amountMinorUnits, 500000);
  assert.deepEqual(lead.rawPayload, {});
  assert.equal(lead.captureLeadId, null);
});

test('lead title is required and bounded', () => {
  assert.throws(() => validateLeadInput({ title: '' }), LeadValidationError);
  assert.throws(() => validateLeadInput({ title: 'x'.repeat(201) }), /1–200/);
});

test('amount must be a non-negative integer of minor units', () => {
  assert.throws(() => validateLeadInput({ title: 'D', amountMinorUnits: -1 }), /minor units/);
  assert.throws(() => validateLeadInput({ title: 'D', amountMinorUnits: 12.5 }), /minor units/);
  assert.equal(validateLeadInput({ title: 'D' }).amountMinorUnits, null);
});

test('currency must be a 3-letter code', () => {
  assert.throws(() => validateLeadInput({ title: 'D', currency: 'dollars' }), /3-letter/);
  assert.equal(validateLeadInput({ title: 'D', currency: 'eur' }).currency, 'EUR');
});

test('stage validation and closed-stage rule', () => {
  for (const s of LEAD_STAGES) assert.equal(validateStage(s), s);
  assert.throws(() => validateStage('MAYBE'), /Unknown stage/);
  assert.equal(isClosedStage('WON'), true);
  assert.equal(isClosedStage('LOST'), true);
  assert.equal(isClosedStage('QUALIFIED'), false);
});

test('accountId/contactId must be uuids when present', () => {
  assert.throws(() => validateLeadInput({ title: 'D', accountId: 'x' }), /valid identifier/);
});

test('outbound_gtm is an accepted lead source and keeps raw_payload first', () => {
  const lead = validateLeadInput({
    title: 'Warm reply',
    source: OUTBOUND_GTM_LEAD_SOURCE,
    rawPayload: { fromEmail: 'a@b.co', proposedClass: 'interested' },
  });
  assert.equal(lead.source, 'outbound_gtm');
  assert.equal(lead.rawPayload.fromEmail, 'a@b.co');
  assert.equal(isAcceptedLeadSource('outbound_gtm'), true);
  assert.throws(() => validateLeadInput({ title: 'D', source: 'apollo' }), /Unknown source/);
});

test('mapCaptureStageToCrm collapses 19 stages onto 5 CRM stages', () => {
  assert.equal(mapCaptureStageToCrm('NEW_ENQUIRY'), 'NEW');
  assert.equal(mapCaptureStageToCrm('NURTURE'), 'NEW');
  assert.equal(mapCaptureStageToCrm('QUALIFIED'), 'QUALIFIED');
  assert.equal(mapCaptureStageToCrm('DISCOVERY_COMPLETED'), 'QUALIFIED');
  assert.equal(mapCaptureStageToCrm('APPLICATION_SUBMITTED'), 'PROPOSAL');
  assert.equal(mapCaptureStageToCrm('ACTIVATION'), 'PROPOSAL');
  assert.equal(mapCaptureStageToCrm('WON'), 'WON');
  assert.equal(mapCaptureStageToCrm('LOST'), 'LOST');
  assert.equal(mapCaptureStageToCrm('DISQUALIFIED'), 'LOST');
});

test('I8 convert builds a web_form CRM row and refuses to delete capture', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const result = buildCrmLeadFromCapture({
    captureLeadId: id,
    tenantId: '11111111-1111-1111-1111-111111111111',
    email: 'Ada@Brand.com',
    captureStage: 'APPLICATION_STARTED',
    captureLayerId: 'in-tn-u1',
    rawPayload: { source_key: 'tnagar.site' },
  });
  assert.equal(result.deleteCapture, false);
  assert.equal(result.capturePreserved, true);
  assert.equal(result.input.source, DEMAND_CAPTURE_LEAD_SOURCE);
  assert.equal(result.input.stage, 'PROPOSAL');
  assert.equal(result.input.captureLeadId, id);
  assert.equal(result.input.captureLayerId, 'in-tn-u1');
  assert.equal(result.input.rawPayload.captureLeadId, id);
  assert.match(result.input.title, /Ada@Brand.com/i);
});

test('I8 convert rejects a forged capture id', () => {
  assert.throws(
    () =>
      buildCrmLeadFromCapture({
        captureLeadId: 'not-a-uuid',
        tenantId: 't',
        captureStage: 'NEW_ENQUIRY',
      }),
    /valid identifier/,
  );
});
