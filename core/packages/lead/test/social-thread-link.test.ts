import assert from 'node:assert/strict';
import test from 'node:test';
import { socialThreadLeadMetadata } from '../src/social-thread-link.ts';

test('links a Unibox thread to a CRM lead without creating a second record', () => {
  const meta = socialThreadLeadMetadata({
    threadId: 'th_123',
    provider: 'facebook',
    crmLeadId: '11111111-1111-1111-1111-111111111111',
  });
  assert.equal(meta.socialThreadId, 'th_123');
  assert.equal(meta.crmLeadId, '11111111-1111-1111-1111-111111111111');
  assert.equal(meta.leadHref, '/leads?leadId=11111111-1111-1111-1111-111111111111');
});
