import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GovernedSensitiveReadService,
  type SensitiveReadAuditEvent,
} from '../src/sensitive-read.ts';

const request = {
  requestId: 'read-1',
  tenantId: 'tenant-1',
  requestedBySubjectId: 'subject-1',
  resourceReference: { type: 'regulated-record', id: 'record-1' },
  purpose: 'Provide authorized case review.',
  legalBasis: 'CONSENT',
  requestedAt: '2026-08-26T00:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['consent://1'],
} as const;
const observation = {
  requestId: request.requestId,
  tenantId: request.tenantId,
  resourceReference: request.resourceReference,
  resultReference: 'result://sensitive-read/1',
  classifications: ['RESTRICTED'],
  sourceReferences: ['record://regulated/1'],
  completedAt: '2026-08-26T00:00:01.000Z',
} as const;

function auditRecorder(
  calls: string[],
  captured: SensitiveReadAuditEvent[],
) {
  return {
    record: async (event: SensitiveReadAuditEvent) => {
      calls.push('audit:' + event.outcome);
      captured.push(event);
      return { recorded: true, event };
    },
  };
}

test('audits an authorized read before returning its reference-only observation', async () => {
  const calls: string[] = [];
  const captured: SensitiveReadAuditEvent[] = [];
  const service = new GovernedSensitiveReadService(
    {
      authorize: async () => {
        calls.push('authorize');
        return { decisionId: 'decision-1', allowed: true, reasonKey: 'POLICY_ALLOWED' };
      },
    },
    {
      load: async () => {
        calls.push('load');
        return observation;
      },
    },
    auditRecorder(calls, captured),
    () => 'event-1',
    () => '2026-08-26T00:00:02.000Z',
  );

  const result = await service.read(request);

  assert.deepEqual(calls, ['authorize', 'load', 'audit:ALLOWED']);
  assert.equal(result, observation);
  assert.equal(captured[0]?.resultReference, observation.resultReference);
  assert.equal('payload' in (captured[0] ?? {}), false);
});

test('audits denial without calling the resource loader', async () => {
  const calls: string[] = [];
  const captured: SensitiveReadAuditEvent[] = [];
  const service = new GovernedSensitiveReadService(
    {
      authorize: async () => {
        calls.push('authorize');
        return { decisionId: 'decision-denied', allowed: false, reasonKey: 'CONSENT_REQUIRED' };
      },
    },
    {
      load: async () => {
        calls.push('load');
        throw new Error('must not be called');
      },
    },
    auditRecorder(calls, captured),
    () => 'event-denied',
    () => '2026-08-26T00:00:02.000Z',
  );

  await assert.rejects(service.read(request), /SENSITIVE_READ_DENIED:CONSENT_REQUIRED/);
  assert.deepEqual(calls, ['authorize', 'audit:DENIED']);
  assert.equal(captured[0]?.resultReference, null);
});

test('audits a failed loader without recording its error payload', async () => {
  const calls: string[] = [];
  const captured: SensitiveReadAuditEvent[] = [];
  const service = new GovernedSensitiveReadService(
    {
      authorize: async () => ({
        decisionId: 'decision-1',
        allowed: true,
        reasonKey: 'POLICY_ALLOWED',
      }),
    },
    {
      load: async () => {
        calls.push('load');
        throw new Error('provider included sensitive diagnostic');
      },
    },
    auditRecorder(calls, captured),
    () => 'event-failed',
    () => '2026-08-26T00:00:02.000Z',
  );

  await assert.rejects(service.read(request), /provider included sensitive diagnostic/);
  assert.deepEqual(calls, ['load', 'audit:FAILED']);
  assert.equal(captured[0]?.failureReasonKey, 'RESOURCE_LOAD_FAILED');
  assert.equal(JSON.stringify(captured[0]).includes('sensitive diagnostic'), false);
});

test('audit persistence failure prevents successful read return', async () => {
  const service = new GovernedSensitiveReadService(
    {
      authorize: async () => ({
        decisionId: 'decision-1',
        allowed: true,
        reasonKey: 'POLICY_ALLOWED',
      }),
    },
    { load: async () => observation },
    {
      record: async () => {
        throw new Error('AUDIT_UNAVAILABLE');
      },
    },
    () => 'event-1',
    () => '2026-08-26T00:00:02.000Z',
  );

  await assert.rejects(service.read(request), /AUDIT_UNAVAILABLE/);
});
