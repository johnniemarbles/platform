import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from './helpers/harness.ts';

test('crm module: permission denial, cross-tenant isolation, list filtering, governed stage transitions, conversion, and hierarchy scope', async () => {
  const harness = await setupHarness('dentex');
  const owner = await harness.asRole('owner');
  const staff = await harness.asRole('staff');
  const viewer = await harness.asRole('viewer');
  const tenant2Owner = await harness.asTenant('tenant-b', 'owner');

  // 1. Permission denial
  // Viewer cannot create accounts (needs crm.account.write)
  const viewerCreateAcc = await viewer.request('POST', '/v1/crm/accounts', { name: 'Unauthorized Corp' });
  assert.equal(viewerCreateAcc.status, 403);
  assert.equal(viewerCreateAcc.body.code, 'TOKEN_SCOPE_MISMATCH');

  // Viewer cannot create leads (needs crm.lead.write)
  const viewerCreateLead = await viewer.request('POST', '/v1/crm/leads', { title: 'Unauthorized Lead' });
  assert.equal(viewerCreateLead.status, 403);
  assert.equal(viewerCreateLead.body.code, 'TOKEN_SCOPE_MISMATCH');

  // 2. Accounts CRUD, list pagination, and search
  const acc1Res = await owner.request('POST', '/v1/crm/accounts', {
    name: 'Alpha Dental',
    domain: 'alphadental.com',
    industry: 'Healthcare',
  });
  assert.equal(acc1Res.status, 200);
  const acc1 = acc1Res.body.result;
  assert.equal(acc1.name, 'Alpha Dental');
  assert.equal(acc1.lifecycleStage, 'PROSPECT');

  const acc2Res = await owner.request('POST', '/v1/crm/accounts', {
    name: 'Beta Orthodontics',
    domain: 'betaortho.com',
    industry: 'Healthcare',
  });
  assert.equal(acc2Res.status, 200);
  const acc2 = acc2Res.body.result;

  const acc3Res = await owner.request('POST', '/v1/crm/accounts', {
    name: 'Gamma Implants',
    domain: 'gammaimplants.com',
    industry: 'Healthcare',
  });
  assert.equal(acc3Res.status, 200);

  // Pagination limit=2
  const pageRes = await owner.request('GET', '/v1/crm/accounts?limit=2');
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.body.result.items.length, 2);

  // Search by query
  const searchRes = await owner.request('GET', '/v1/crm/accounts?q=Orthodontics');
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.result.items.length, 1);
  assert.equal(searchRes.body.result.items[0].name, 'Beta Orthodontics');

  // Patch account
  const patchAccRes = await owner.request('PATCH', `/v1/crm/accounts/${acc1.accountId}`, {
    industry: 'Dental Services',
  });
  assert.equal(patchAccRes.status, 200);
  assert.equal(patchAccRes.body.result.industry, 'Dental Services');

  // 3. Cross-tenant 404
  const crossTenantGet = await tenant2Owner.request('GET', `/v1/crm/accounts/${acc1.accountId}`);
  assert.equal(crossTenantGet.status, 404);
  assert.equal(crossTenantGet.body.code, 'REFUSED');

  // 4. Contacts CRUD
  const contactRes = await owner.request('POST', '/v1/crm/contacts', {
    fullName: 'Dr. Alice Smith',
    email: 'alice@alphadental.com',
    phone: '+15550100',
    accountId: acc1.accountId,
    title: 'Lead Dentist',
  });
  assert.equal(contactRes.status, 200);
  const contact = contactRes.body.result;
  assert.equal(contact.fullName, 'Dr. Alice Smith');
  assert.equal(contact.accountId, acc1.accountId);

  const contactListRes = await owner.request('GET', `/v1/crm/contacts?accountId=${acc1.accountId}`);
  assert.equal(contactListRes.status, 200);
  assert.ok(contactListRes.body.result.items.some((c: any) => c.contactId === contact.contactId));

  // 5. Governed Lead Stage Transitions
  const leadRes = await owner.request('POST', '/v1/crm/leads', {
    title: 'Alpha Expansion Deal',
    stage: 'NEW',
    accountId: acc1.accountId,
    contactId: contact.contactId,
    amountMinorUnits: 1500000,
    currency: 'USD',
  });
  assert.equal(leadRes.status, 200);
  const lead = leadRes.body.result;
  assert.equal(lead.stage, 'NEW');

  // Standard transition NEW -> QUALIFIED without reason
  const trans1 = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/transition`, {
    to: 'QUALIFIED',
  });
  assert.equal(trans1.status, 200);
  assert.equal(trans1.body.result.stage, 'QUALIFIED');

  // Override transition QUALIFIED -> NEW without reason should fail (400)
  const transNoReason = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/transition`, {
    to: 'NEW',
  });
  assert.equal(transNoReason.status, 400);

  // Override transition QUALIFIED -> NEW with reason succeeds
  const transWithReason = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/transition`, {
    to: 'NEW',
    reason: 'Re-evaluating clinic requirements with partner',
  });
  assert.equal(transWithReason.status, 200);
  assert.equal(transWithReason.body.result.stage, 'NEW');

  // Move to PROPOSAL
  const transProposal = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/transition`, {
    to: 'PROPOSAL',
    reason: 'Client requested fast-track pricing',
  });
  assert.equal(transProposal.status, 200);
  assert.equal(transProposal.body.result.stage, 'PROPOSAL');

  // 6. Convert Lead: Staff cannot convert (needs crm.lead.convert)
  const staffConvert = await staff.request('POST', `/v1/crm/leads/${lead.leadId}/convert`, {
    openCase: true,
  });
  assert.equal(staffConvert.status, 403);
  assert.equal(staffConvert.body.code, 'TOKEN_SCOPE_MISMATCH');

  // Owner converts lead into WON + CUSTOMER + Agreement + Case
  const convertRes = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/convert`, {
    openCase: true,
    caseSubject: 'Alpha Clinic Onboarding',
    agreementTitle: 'Alpha 2-Year Service Agreement',
    agreementValueMinorUnits: 1500000,
  });
  assert.equal(convertRes.status, 200);
  const conversion = convertRes.body.result;
  assert.equal(conversion.lead.stage, 'WON');
  assert.equal(conversion.account.lifecycleStage, 'CUSTOMER');
  assert.ok(conversion.agreement);
  assert.equal(conversion.agreement.title, 'Alpha 2-Year Service Agreement');
  assert.equal(conversion.agreement.valueMinorUnits, 1500000);
  assert.ok(conversion.case);
  assert.equal(conversion.case.subject, 'Alpha Clinic Onboarding');

  // Illegal transition: WON cannot transition back to NEW or any other stage
  const transWon = await owner.request('POST', `/v1/crm/leads/${lead.leadId}/transition`, {
    to: 'NEW',
    reason: 'Reopening won lead',
  });
  assert.equal(transWon.status, 400);

  // Verify agreements and cases list endpoints
  const agList = await owner.request('GET', `/v1/crm/agreements?accountId=${acc1.accountId}`);
  assert.equal(agList.status, 200);
  assert.ok(agList.body.result.items.some((a: any) => a.agreementId === conversion.agreement.agreementId));

  const caseList = await owner.request('GET', `/v1/crm/cases?accountId=${acc1.accountId}`);
  assert.equal(caseList.status, 200);
  assert.ok(caseList.body.result.items.some((c: any) => c.caseId === conversion.case.caseId));

  // 7. Cross-hierarchy isolation on organization-scoped leads
  // Setup organizations in DB: HQ (parent), West (child of HQ), East (sibling of West)
  const tenantRes = await harness.pg.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM platform.tenants WHERE workspace_name = 'dentex-test'"
  );
  const tenantId = tenantRes.rows[0]!.tenant_id;
  await harness.pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);

  const orgHqRes = await harness.pg.query<{ organization_id: string }>(
    `INSERT INTO platform.organizations (tenant_id, name, organization_kind)
     VALUES ($1, 'HQ Org', 'BRAND')
     RETURNING organization_id`,
    [tenantId]
  );
  const hqOrgId = orgHqRes.rows[0]!.organization_id;

  const orgWestRes = await harness.pg.query<{ organization_id: string }>(
    `INSERT INTO platform.organizations (tenant_id, parent_organization_id, name, organization_kind)
     VALUES ($1, $2, 'West Clinic', 'LOCATION')
     RETURNING organization_id`,
    [tenantId, hqOrgId]
  );
  const westOrgId = orgWestRes.rows[0]!.organization_id;

  const orgEastRes = await harness.pg.query<{ organization_id: string }>(
    `INSERT INTO platform.organizations (tenant_id, parent_organization_id, name, organization_kind)
     VALUES ($1, $2, 'East Clinic', 'LOCATION')
     RETURNING organization_id`,
    [tenantId, hqOrgId]
  );
  const eastOrgId = orgEastRes.rows[0]!.organization_id;

  // Insert an East lead
  const eastLeadRes = await harness.pg.query<{ lead_id: string }>(
    `INSERT INTO platform.crm_leads (tenant_id, organization_id, title, stage)
     VALUES ($1, $2, 'East Dental Inquiry', 'NEW')
     RETURNING lead_id`,
    [tenantId, eastOrgId]
  );
  const eastLeadId = eastLeadRes.rows[0]!.lead_id;

  // Create West-scoped member
  const westSubject = 'usr_west_scope';
  const westMRes = await harness.pg.query<{ membership_id: string; person_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'platform-dev', $2)
     RETURNING membership_id, person_id`,
    [tenantId, westSubject]
  );
  const westRoleId = (await harness.pg.query<{ role_id: string }>(
    "SELECT role_id FROM platform.roles WHERE tenant_id = $1 AND role_key = 'owner'",
    [tenantId]
  )).rows[0]!.role_id;

  await harness.pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
     VALUES ($1, 'app_dentex', 'owner', $2, ARRAY['crm.lead.read', 'crm.lead.write'], $3, $4)`,
    [westMRes.rows[0]!.membership_id, westRoleId, `org/${westOrgId}`, westMRes.rows[0]!.person_id]
  );

  // Create HQ-scoped member
  const hqSubject = 'usr_hq_scope';
  const hqMRes = await harness.pg.query<{ membership_id: string; person_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'platform-dev', $2)
     RETURNING membership_id, person_id`,
    [tenantId, hqSubject]
  );
  await harness.pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
     VALUES ($1, 'app_dentex', 'owner', $2, ARRAY['crm.lead.read', 'crm.lead.write'], $3, $4)`,
    [hqMRes.rows[0]!.membership_id, westRoleId, `org/${hqOrgId}`, hqMRes.rows[0]!.person_id]
  );

  // Verify DB level cross-hierarchy access directly with set_request_context inside transactions
  // 1) West context cannot read East lead (cross-hierarchy denial)
  await harness.pg.query('BEGIN;');
  await harness.pg.query(
    "SELECT platform.set_request_context($1::uuid, 'app_dentex', 'staff', 'platform-operational', NULL, $2::uuid)",
    [tenantId, westOrgId]
  );
  const westRead = await harness.pg.query(
    'SELECT lead_id FROM platform.crm_leads WHERE lead_id = $1::uuid',
    [eastLeadId]
  );
  await harness.pg.query('COMMIT;');
  assert.equal(westRead.rows.length, 0, 'West-scoped context must not read East-scoped lead');

  // 2) HQ context can read East lead (parent access to descendant)
  await harness.pg.query('BEGIN;');
  await harness.pg.query(
    "SELECT platform.set_request_context($1::uuid, 'app_dentex', 'staff', 'platform-operational', NULL, $2::uuid)",
    [tenantId, hqOrgId]
  );
  const hqRead = await harness.pg.query(
    'SELECT lead_id FROM platform.crm_leads WHERE lead_id = $1::uuid',
    [eastLeadId]
  );
  await harness.pg.query('COMMIT;');
  assert.equal(hqRead.rows.length, 1, 'HQ parent context must be able to read East child lead');

  // 3) Tenant-wide context (no organization restriction) can read all
  await harness.pg.query('BEGIN;');
  await harness.pg.query(
    "SELECT platform.set_request_context($1::uuid, 'app_dentex', 'staff', 'platform-operational', NULL, NULL)",
    [tenantId]
  );
  const rootRead = await harness.pg.query(
    'SELECT lead_id FROM platform.crm_leads WHERE lead_id = $1::uuid',
    [eastLeadId]
  );
  await harness.pg.query('COMMIT;');
  assert.equal(rootRead.rows.length, 1, 'Tenant-wide context must be able to read all leads');

  await harness.close();
});
