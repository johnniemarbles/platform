import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from '../../../apps/platform-api/test/helpers/harness.ts';
import type { Transport } from '@platform-sdk/transport';
import { assertShape } from '../../transport/src/test-utils.ts';
import { crmClient } from '../src/index.ts';

test('crm sdk: contract tests against real platform-api for accounts, contacts, leads, transition, convert, cases, agreements', async () => {
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

  const client = crmClient(transport);

  // 1. Account lifecycle
  const account = await client.accounts.create({
    name: 'Acme Corp',
    domain: 'acme.com',
    industry: 'Technology',
  });
  assertShape(account, {
    accountId: 'string',
    tenantId: 'string',
    name: 'string',
    lifecycleStage: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  });
  assert.equal(account.name, 'Acme Corp');

  const accountsList = await client.accounts.list();
  assert.ok(accountsList.items.some(a => a.accountId === account.accountId));

  const patchedAccount = await client.accounts.update(account.accountId, { industry: 'Software' });
  assert.equal(patchedAccount.industry, 'Software');

  // 2. Contact lifecycle
  const contact = await client.contacts.create({
    fullName: 'Jane Doe',
    email: 'jane@acme.com',
    phone: '+15551234567',
    accountId: account.accountId,
  });
  assertShape(contact, {
    contactId: 'string',
    tenantId: 'string',
    fullName: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  });
  assert.equal(contact.fullName, 'Jane Doe');

  const contactsList = await client.contacts.list({ accountId: account.accountId });
  assert.ok(contactsList.items.some(c => c.contactId === contact.contactId));

  // 3. Lead lifecycle
  const lead = await client.leads.create({
    title: 'Acme Enterprise Expansion',
    stage: 'NEW',
    accountId: account.accountId,
    contactId: contact.contactId,
    amountMinorUnits: 5000000,
    currency: 'USD',
  });
  assertShape(lead, {
    leadId: 'string',
    tenantId: 'string',
    title: 'string',
    stage: 'string',
    currency: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  });
  assert.equal(lead.stage, 'NEW');
  assert.equal(lead.amountMinorUnits, 5000000);

  // 4. Transition: NEW -> QUALIFIED
  const qualifiedLead = await client.leads.transition(lead.leadId, { to: 'QUALIFIED' });
  assert.equal(qualifiedLead.stage, 'QUALIFIED');

  // 5. Convert: lead -> account customer + agreement + case
  const convertRes = await client.leads.convert(lead.leadId, {
    openCase: true,
    caseSubject: 'Acme Onboarding Case',
    agreementTitle: 'Acme Master Services Agreement',
    agreementValueMinorUnits: 5000000,
  });
  assert.equal(convertRes.lead.stage, 'WON');
  assert.equal(convertRes.account.lifecycleStage, 'CUSTOMER');
  assert.ok(convertRes.agreement);
  assert.equal(convertRes.agreement.title, 'Acme Master Services Agreement');
  assert.equal(convertRes.agreement.valueMinorUnits, 5000000);
  assert.ok(convertRes.case);
  assert.equal(convertRes.case.subject, 'Acme Onboarding Case');

  // 6. Verify agreement and case queries
  const agreements = await client.agreements.list({ accountId: account.accountId });
  assert.ok(agreements.items.some(a => a.agreementId === convertRes.agreement.agreementId));

  const cases = await client.cases.list({ accountId: account.accountId });
  assert.ok(cases.items.some(c => c.caseId === convertRes.case!.caseId));

  await harness.close();
});
