import type { Transport } from '@platform-sdk/transport';

export interface CrmAccount {
  readonly accountId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
  readonly name: string;
  readonly domain: string | null;
  readonly industry: string | null;
  readonly lifecycleStage: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmContact {
  readonly contactId: string;
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmLead {
  readonly leadId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
  readonly accountId: string | null;
  readonly contactId: string | null;
  readonly title: string;
  readonly stage: string;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly ownerSubjectId: string | null;
  readonly rawPayload: Record<string, unknown>;
  readonly captureLeadId: string | null;
  readonly captureLayerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmCase {
  readonly caseId: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly contactId: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmAgreement {
  readonly agreementId: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly sourceLeadId: string | null;
  readonly title: string;
  readonly status: string;
  readonly valueMinorUnits: number | null;
  readonly currency: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConvertLeadResult {
  readonly lead: CrmLead;
  readonly account: CrmAccount;
  readonly contact: CrmContact | null;
  readonly agreement: CrmAgreement;
  readonly case: CrmCase | null;
}

export interface CrmClient {
  readonly accounts: {
    list(params?: { limit?: number; lifecycleStage?: string; q?: string }): Promise<{ items: readonly CrmAccount[] }>;
    get(id: string): Promise<CrmAccount>;
    create(input: { name: string; domain?: string; industry?: string; organizationId?: string }): Promise<CrmAccount>;
    update(id: string, patch: Partial<{ name: string; domain: string; industry: string; lifecycleStage: string; status: string }>): Promise<CrmAccount>;
  };
  readonly contacts: {
    list(params?: { limit?: number; accountId?: string; q?: string }): Promise<{ items: readonly CrmContact[] }>;
    get(id: string): Promise<CrmContact>;
    create(input: { fullName: string; accountId?: string; email?: string; phone?: string; title?: string }): Promise<CrmContact>;
    update(id: string, patch: Partial<{ fullName: string; accountId: string; email: string; phone: string; title: string; status: string }>): Promise<CrmContact>;
  };
  readonly leads: {
    list(params?: { limit?: number; stage?: string; accountId?: string }): Promise<{ items: readonly CrmLead[] }>;
    get(id: string): Promise<CrmLead>;
    create(input: {
      title: string;
      stage?: string;
      accountId?: string;
      contactId?: string;
      amountMinorUnits?: number;
      currency?: string;
      source?: string;
      rawPayload?: Record<string, unknown>;
      organizationId?: string;
    }): Promise<CrmLead>;
    update(id: string, patch: Partial<{ title: string; accountId: string; contactId: string; amountMinorUnits: number }>): Promise<CrmLead>;
    transition(id: string, input: { to: string; reason?: string }): Promise<CrmLead>;
    convert(id: string, input?: { openCase?: boolean; caseSubject?: string; agreementTitle?: string; agreementValueMinorUnits?: number }): Promise<ConvertLeadResult>;
  };
  readonly cases: {
    list(params?: { limit?: number; status?: string; accountId?: string }): Promise<{ items: readonly CrmCase[] }>;
    get(id: string): Promise<CrmCase>;
    create(input: { subject: string; accountId: string; contactId?: string; description?: string; priority?: string }): Promise<CrmCase>;
    update(id: string, patch: Partial<{ subject: string; description: string; priority: string; status: string }>): Promise<CrmCase>;
  };
  readonly agreements: {
    list(params?: { limit?: number; status?: string; accountId?: string }): Promise<{ items: readonly CrmAgreement[] }>;
    get(id: string): Promise<CrmAgreement>;
    create(input: {
      title: string;
      accountId: string;
      sourceLeadId?: string;
      valueMinorUnits?: number;
      currency?: string;
      startsOn?: string;
      endsOn?: string;
    }): Promise<CrmAgreement>;
    update(id: string, patch: Partial<{ title: string; status: string; valueMinorUnits: number }>): Promise<CrmAgreement>;
  };
}

function queryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export function crmClient(t: Transport): CrmClient {
  return {
    accounts: {
      list: (p) => t.request('GET', `/v1/crm/accounts${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/crm/accounts/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/crm/accounts', input),
      update: (id, patch) => t.request('PATCH', `/v1/crm/accounts/${encodeURIComponent(id)}`, patch),
    },
    contacts: {
      list: (p) => t.request('GET', `/v1/crm/contacts${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/crm/contacts/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/crm/contacts', input),
      update: (id, patch) => t.request('PATCH', `/v1/crm/contacts/${encodeURIComponent(id)}`, patch),
    },
    leads: {
      list: (p) => t.request('GET', `/v1/crm/leads${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/crm/leads/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/crm/leads', input),
      update: (id, patch) => t.request('PATCH', `/v1/crm/leads/${encodeURIComponent(id)}`, patch),
      transition: (id, input) => t.request('POST', `/v1/crm/leads/${encodeURIComponent(id)}/transition`, input),
      convert: (id, input) => t.request('POST', `/v1/crm/leads/${encodeURIComponent(id)}/convert`, input ?? {}),
    },
    cases: {
      list: (p) => t.request('GET', `/v1/crm/cases${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/crm/cases/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/crm/cases', input),
      update: (id, patch) => t.request('PATCH', `/v1/crm/cases/${encodeURIComponent(id)}`, patch),
    },
    agreements: {
      list: (p) => t.request('GET', `/v1/crm/agreements${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/crm/agreements/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/crm/agreements', input),
      update: (id, patch) => t.request('PATCH', `/v1/crm/agreements/${encodeURIComponent(id)}`, patch),
    },
  };
}
