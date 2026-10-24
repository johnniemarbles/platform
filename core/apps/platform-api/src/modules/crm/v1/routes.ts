import type { IncomingMessage } from 'node:http';
import type { HandlerContext, RouteDefinition } from '@platform-core/route-kit';
import { readJson } from '@platform-core/route-kit';
import { refusal } from '@platform-hub/contracts';
import {
  type LeadStage,
  validateStage,
  classifyLeadTransition,
  leadTransitionRequiresReason,
  type CrmAccount,
  type CrmContact,
  type CrmLead,
  type CrmCase,
  type CrmAgreement,
  type ConvertLeadResult,
} from '@platform-core/crm';

function parseLimit(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : 50;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}

function mapAccount(r: {
  account_id: string;
  tenant_id: string;
  organization_id: string | null;
  name: string;
  domain: string | null;
  industry: string | null;
  lifecycle_stage: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}): CrmAccount {
  return {
    accountId: r.account_id,
    tenantId: r.tenant_id,
    organizationId: r.organization_id,
    name: r.name,
    domain: r.domain,
    industry: r.industry,
    lifecycleStage: r.lifecycle_stage,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapContact(r: {
  contact_id: string;
  tenant_id: string;
  account_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}): CrmContact {
  return {
    contactId: r.contact_id,
    tenantId: r.tenant_id,
    accountId: r.account_id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    title: r.title,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapLead(r: {
  lead_id: string;
  tenant_id: string;
  organization_id?: string | null;
  account_id: string | null;
  contact_id: string | null;
  title: string;
  stage: string;
  amount_minor_units: string | number | null;
  currency: string;
  source: string | null;
  owner_subject_id: string | null;
  enquiry_payload?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}): CrmLead {
  return {
    leadId: r.lead_id,
    tenantId: r.tenant_id,
    organizationId: r.organization_id ?? null,
    accountId: r.account_id,
    contactId: r.contact_id,
    title: r.title,
    stage: r.stage as LeadStage,
    amountMinorUnits: r.amount_minor_units !== null && r.amount_minor_units !== undefined ? Number(r.amount_minor_units) : null,
    currency: r.currency,
    source: r.source,
    ownerSubjectId: r.owner_subject_id,
    rawPayload: (r.enquiry_payload as Record<string, unknown>) ?? {},
    captureLeadId: null,
    captureLayerId: null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapCase(r: {
  case_id: string;
  tenant_id: string;
  account_id: string;
  contact_id: string | null;
  subject: string;
  description: string | null;
  priority: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}): CrmCase {
  return {
    caseId: r.case_id,
    tenantId: r.tenant_id,
    accountId: r.account_id,
    contactId: r.contact_id,
    subject: r.subject,
    description: r.description,
    priority: r.priority,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapAgreement(r: {
  agreement_id: string;
  tenant_id: string;
  account_id: string;
  source_lead_id: string | null;
  title: string;
  status: string;
  value_minor_units: string | number | null;
  currency: string;
  starts_on: Date | string | null;
  ends_on: Date | string | null;
  created_at: Date;
  updated_at: Date;
}): CrmAgreement {
  return {
    agreementId: r.agreement_id,
    tenantId: r.tenant_id,
    accountId: r.account_id,
    sourceLeadId: r.source_lead_id,
    title: r.title,
    status: r.status,
    valueMinorUnits: r.value_minor_units !== null && r.value_minor_units !== undefined ? Number(r.value_minor_units) : null,
    currency: r.currency,
    startsOn: r.starts_on ? String(r.starts_on) : null,
    endsOn: r.ends_on ? String(r.ends_on) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function crmV1Routes(): readonly RouteDefinition[] {
  return [
    // ---------------- Accounts ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/accounts',
      requires: ['crm.account.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const lifecycle = ctx.url.searchParams.get('lifecycleStage')?.trim() ?? '';
        const search = ctx.url.searchParams.get('q')?.trim() ?? '';

        const res = await ctx.tx.query<{
          account_id: string;
          tenant_id: string;
          organization_id: string | null;
          name: string;
          domain: string | null;
          industry: string | null;
          lifecycle_stage: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT account_id, tenant_id, organization_id, name, domain, industry,
                  lifecycle_stage, status, created_at, updated_at
             FROM platform.crm_accounts
            WHERE ($1 = '' OR lifecycle_stage = $1)
              AND ($2 = '' OR name ILIKE ('%' || $2 || '%'))
            ORDER BY created_at DESC
            LIMIT $3`,
          [lifecycle, search, limit]
        );

        return {
          items: res.rows.map(mapAccount),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/accounts',
      requires: ['crm.account.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name.length === 0 || name.length > 200) {
          return refusal('REFUSED', ctx.traceId, 'Account name must be 1-200 characters');
        }
        const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : null;
        const industry = typeof body.industry === 'string' ? body.industry.trim() : null;
        const orgId = typeof body.organizationId === 'string' ? body.organizationId.trim() : null;

        const res = await ctx.tx.query<{
          account_id: string;
          tenant_id: string;
          organization_id: string | null;
          name: string;
          domain: string | null;
          industry: string | null;
          lifecycle_stage: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_accounts (tenant_id, organization_id, name, domain, industry)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5)
           RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                     lifecycle_stage, status, created_at, updated_at`,
          [ctx.membership.tenantId, orgId, name, domain, industry]
        );
        return mapAccount(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/accounts/:id',
      pattern: /^\/v1\/crm\/accounts\/([0-9a-fA-F-]+)$/,
      requires: ['crm.account.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          account_id: string;
          tenant_id: string;
          organization_id: string | null;
          name: string;
          domain: string | null;
          industry: string | null;
          lifecycle_stage: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT account_id, tenant_id, organization_id, name, domain, industry,
                  lifecycle_stage, status, created_at, updated_at
             FROM platform.crm_accounts
            WHERE account_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapAccount(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/crm/accounts/:id',
      pattern: /^\/v1\/crm\/accounts\/([0-9a-fA-F-]+)$/,
      requires: ['crm.account.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const name = typeof body.name === 'string' ? body.name.trim() : undefined;
        const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : undefined;
        const industry = typeof body.industry === 'string' ? body.industry.trim() : undefined;
        const lifecycleStage = typeof body.lifecycleStage === 'string' ? body.lifecycleStage.trim().toUpperCase() : undefined;
        const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;

        const res = await ctx.tx.query<{
          account_id: string;
          tenant_id: string;
          organization_id: string | null;
          name: string;
          domain: string | null;
          industry: string | null;
          lifecycle_stage: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_accounts
              SET name = COALESCE($2, name),
                  domain = COALESCE($3, domain),
                  industry = COALESCE($4, industry),
                  lifecycle_stage = COALESCE($5, lifecycle_stage),
                  status = COALESCE($6, status),
                  updated_at = now()
            WHERE account_id = $1::uuid
            RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                      lifecycle_stage, status, created_at, updated_at`,
          [id, name ?? null, domain ?? null, industry ?? null, lifecycleStage ?? null, status ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapAccount(res.rows[0]!);
      },
    },

    // ---------------- Contacts ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/contacts',
      requires: ['crm.contact.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const accountId = ctx.url.searchParams.get('accountId')?.trim() ?? '';
        const search = ctx.url.searchParams.get('q')?.trim() ?? '';

        const res = await ctx.tx.query<{
          contact_id: string;
          tenant_id: string;
          account_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          title: string | null;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT contact_id, tenant_id, account_id, full_name, email, phone, title,
                  status, created_at, updated_at
             FROM platform.crm_contacts
            WHERE ($1 = '' OR account_id = $1::uuid)
              AND ($2 = '' OR full_name ILIKE ('%' || $2 || '%') OR email ILIKE ('%' || $2 || '%'))
            ORDER BY created_at DESC
            LIMIT $3`,
          [accountId, search, limit]
        );

        return {
          items: res.rows.map(mapContact),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/contacts',
      requires: ['crm.contact.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
        if (fullName.length === 0 || fullName.length > 200) {
          return refusal('REFUSED', ctx.traceId, 'Full name must be 1-200 characters');
        }
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : null;
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
        const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
        const title = typeof body.title === 'string' ? body.title.trim() : null;

        const res = await ctx.tx.query<{
          contact_id: string;
          tenant_id: string;
          account_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          title: string | null;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_contacts (tenant_id, account_id, full_name, email, phone, title)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
           RETURNING contact_id, tenant_id, account_id, full_name, email, phone, title,
                     status, created_at, updated_at`,
          [ctx.membership.tenantId, accountId, fullName, email, phone, title]
        );
        return mapContact(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/contacts/:id',
      pattern: /^\/v1\/crm\/contacts\/([0-9a-fA-F-]+)$/,
      requires: ['crm.contact.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          contact_id: string;
          tenant_id: string;
          account_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          title: string | null;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT contact_id, tenant_id, account_id, full_name, email, phone, title,
                  status, created_at, updated_at
             FROM platform.crm_contacts
            WHERE contact_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapContact(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/crm/contacts/:id',
      pattern: /^\/v1\/crm\/contacts\/([0-9a-fA-F-]+)$/,
      requires: ['crm.contact.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : undefined;
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : undefined;
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
        const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;

        const res = await ctx.tx.query<{
          contact_id: string;
          tenant_id: string;
          account_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          title: string | null;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_contacts
              SET full_name = COALESCE($2, full_name),
                  account_id = COALESCE($3::uuid, account_id),
                  email = COALESCE($4, email),
                  phone = COALESCE($5, phone),
                  title = COALESCE($6, title),
                  status = COALESCE($7, status),
                  updated_at = now()
            WHERE contact_id = $1::uuid
            RETURNING contact_id, tenant_id, account_id, full_name, email, phone, title,
                      status, created_at, updated_at`,
          [id, fullName ?? null, accountId ?? null, email ?? null, phone ?? null, title ?? null, status ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapContact(res.rows[0]!);
      },
    },

    // ---------------- Leads ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/leads',
      requires: ['crm.lead.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const stage = ctx.url.searchParams.get('stage')?.trim() ?? '';
        const accountId = ctx.url.searchParams.get('accountId')?.trim() ?? '';

        const res = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT lead_id, tenant_id, organization_id, account_id, contact_id, title,
                  stage, amount_minor_units, currency, source, owner_subject_id,
                  enquiry_payload, created_at, updated_at
             FROM platform.crm_leads
            WHERE ($1 = '' OR stage = $1)
              AND ($2 = '' OR account_id = $2::uuid)
            ORDER BY created_at DESC
            LIMIT $3`,
          [stage, accountId, limit]
        );

        return {
          items: res.rows.map(mapLead),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/leads',
      requires: ['crm.lead.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (title.length === 0 || title.length > 200) {
          return refusal('REFUSED', ctx.traceId, 'Lead title must be 1-200 characters');
        }
        let stage: LeadStage = 'NEW';
        if (typeof body.stage === 'string') {
          const valid = validateStage(body.stage);
          if (!valid) {
            return refusal('REFUSED', ctx.traceId, `Invalid stage: ${body.stage}`);
          }
          stage = valid;
        }
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : null;
        const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : null;
        const amountMinorUnits = typeof body.amountMinorUnits === 'number' && Number.isFinite(body.amountMinorUnits)
          ? Math.round(body.amountMinorUnits)
          : null;
        const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : 'USD';
        const source = typeof body.source === 'string' ? body.source.trim() : 'manual';
        const rawPayload = body.rawPayload && typeof body.rawPayload === 'object' ? body.rawPayload : {};
        const orgId = typeof body.organizationId === 'string' ? body.organizationId.trim() : null;

        const res = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_leads (
             tenant_id, organization_id, account_id, contact_id, title,
             stage, amount_minor_units, currency, source, enquiry_payload, owner_subject_id
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
             $6, $7, $8, $9, $10::jsonb, $11
           ) RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title,
                       stage, amount_minor_units, currency, source, owner_subject_id,
                       enquiry_payload, created_at, updated_at`,
          [
            ctx.membership.tenantId,
            orgId,
            accountId,
            contactId,
            title,
            stage,
            amountMinorUnits,
            currency,
            source,
            JSON.stringify(rawPayload),
            ctx.membership.personId,
          ]
        );
        return mapLead(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/leads/:id',
      pattern: /^\/v1\/crm\/leads\/([0-9a-fA-F-]+)$/,
      requires: ['crm.lead.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT lead_id, tenant_id, organization_id, account_id, contact_id, title,
                  stage, amount_minor_units, currency, source, owner_subject_id,
                  enquiry_payload, created_at, updated_at
             FROM platform.crm_leads
            WHERE lead_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapLead(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/crm/leads/:id',
      pattern: /^\/v1\/crm\/leads\/([0-9a-fA-F-]+)$/,
      requires: ['crm.lead.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : undefined;
        const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : undefined;
        const amountMinorUnits = typeof body.amountMinorUnits === 'number' && Number.isFinite(body.amountMinorUnits)
          ? Math.round(body.amountMinorUnits)
          : undefined;

        const res = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_leads
              SET title = COALESCE($2, title),
                  account_id = COALESCE($3::uuid, account_id),
                  contact_id = COALESCE($4::uuid, contact_id),
                  amount_minor_units = COALESCE($5, amount_minor_units),
                  updated_at = now()
            WHERE lead_id = $1::uuid
            RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title,
                      stage, amount_minor_units, currency, source, owner_subject_id,
                      enquiry_payload, created_at, updated_at`,
          [id, title ?? null, accountId ?? null, contactId ?? null, amountMinorUnits ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapLead(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/leads/:id/transition',
      pattern: /^\/v1\/crm\/leads\/([0-9a-fA-F-]+)\/transition$/,
      requires: ['crm.lead.transition'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const match = ctx.url.pathname.match(/^\/v1\/crm\/leads\/([0-9a-fA-F-]+)\/transition$/);
        const id = match![1];
        const body = await readJson(req);

        const targetStage = typeof body.to === 'string' ? validateStage(body.to) : null;
        if (!targetStage) {
          return refusal('REFUSED', ctx.traceId, `Invalid target stage: ${body.to}`);
        }
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

        // Fetch current lead
        const leadRes = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT lead_id, tenant_id, organization_id, account_id, contact_id, title,
                  stage, amount_minor_units, currency, source, owner_subject_id,
                  enquiry_payload, created_at, updated_at
             FROM platform.crm_leads
            WHERE lead_id = $1::uuid
            FOR UPDATE`,
          [id]
        );
        if (leadRes.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }

        const currentLead = leadRes.rows[0]!;
        const currentStage = currentLead.stage as LeadStage;
        const kind = classifyLeadTransition(currentStage, targetStage);

        if (kind === 'ILLEGAL') {
          return refusal('REFUSED', ctx.traceId, `Transition from ${currentStage} to ${targetStage} is illegal`);
        }
        if (leadTransitionRequiresReason(kind) && !reason) {
          return refusal('REFUSED', ctx.traceId, `Transition from ${currentStage} to ${targetStage} requires a reason`);
        }

        const updateRes = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_leads
              SET stage = $2,
                  updated_at = now()
            WHERE lead_id = $1::uuid
            RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title,
                      stage, amount_minor_units, currency, source, owner_subject_id,
                      enquiry_payload, created_at, updated_at`,
          [id, targetStage]
        );
        return mapLead(updateRes.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/leads/:id/convert',
      pattern: /^\/v1\/crm\/leads\/([0-9a-fA-F-]+)\/convert$/,
      requires: ['crm.lead.convert'],
      handler: async (ctx: HandlerContext, req: IncomingMessage): Promise<ConvertLeadResult | ReturnType<typeof refusal>> => {
        const match = ctx.url.pathname.match(/^\/v1\/crm\/leads\/([0-9a-fA-F-]+)\/convert$/);
        const id = match![1];
        const body = await readJson(req);

        // Fetch lead with lock
        const leadRes = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT lead_id, tenant_id, organization_id, account_id, contact_id, title,
                  stage, amount_minor_units, currency, source, owner_subject_id,
                  enquiry_payload, created_at, updated_at
             FROM platform.crm_leads
            WHERE lead_id = $1::uuid
            FOR UPDATE`,
          [id]
        );
        if (leadRes.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }

        const leadRow = leadRes.rows[0]!;
        if (leadRow.stage === 'LOST') {
          return refusal('REFUSED', ctx.traceId, 'A lost lead cannot be converted. Reopen it first.');
        }

        // 1. Resolve or create Account
        let accountId = leadRow.account_id;
        let accountRow: {
          account_id: string;
          tenant_id: string;
          organization_id: string | null;
          name: string;
          domain: string | null;
          industry: string | null;
          lifecycle_stage: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        };
        if (accountId) {
          const accRes = await ctx.tx.query<{
            account_id: string;
            tenant_id: string;
            organization_id: string | null;
            name: string;
            domain: string | null;
            industry: string | null;
            lifecycle_stage: string;
            status: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `UPDATE platform.crm_accounts
                SET lifecycle_stage = 'CUSTOMER',
                    updated_at = now()
              WHERE account_id = $1::uuid
              RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                        lifecycle_stage, status, created_at, updated_at`,
            [accountId]
          );
          if (accRes.rows.length === 0) {
            return refusal('REFUSED', ctx.traceId, 'Linked account not found');
          }
          accountRow = accRes.rows[0]!;
        } else {
          const accRes = await ctx.tx.query<{
            account_id: string;
            tenant_id: string;
            organization_id: string | null;
            name: string;
            domain: string | null;
            industry: string | null;
            lifecycle_stage: string;
            status: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO platform.crm_accounts (
               tenant_id, organization_id, name, lifecycle_stage, status
             ) VALUES (
               $1::uuid, $2::uuid, $3, 'CUSTOMER', 'ACTIVE'
             ) RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                         lifecycle_stage, status, created_at, updated_at`,
            [ctx.membership.tenantId, leadRow.organization_id, leadRow.title]
          );
          accountRow = accRes.rows[0]!;
          accountId = accountRow.account_id;
        }

        // 2. Fetch contact if present
        let contactRow: {
          contact_id: string;
          tenant_id: string;
          account_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          title: string | null;
          status: string;
          created_at: Date;
          updated_at: Date;
        } | null = null;
        if (leadRow.contact_id) {
          const contRes = await ctx.tx.query<{
            contact_id: string;
            tenant_id: string;
            account_id: string | null;
            full_name: string;
            email: string | null;
            phone: string | null;
            title: string | null;
            status: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `SELECT contact_id, tenant_id, account_id, full_name, email, phone, title,
                    status, created_at, updated_at
               FROM platform.crm_contacts
              WHERE contact_id = $1::uuid`,
            [leadRow.contact_id]
          );
          if (contRes.rows[0]) {
            contactRow = contRes.rows[0];
          }
        }

        // 3. Mark Lead WON
        const wonRes = await ctx.tx.query<{
          lead_id: string;
          tenant_id: string;
          organization_id: string | null;
          account_id: string | null;
          contact_id: string | null;
          title: string;
          stage: string;
          amount_minor_units: string | number | null;
          currency: string;
          source: string | null;
          owner_subject_id: string | null;
          enquiry_payload: Record<string, unknown> | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_leads
              SET stage = 'WON',
                  account_id = $2::uuid,
                  updated_at = now()
            WHERE lead_id = $1::uuid
            RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title,
                      stage, amount_minor_units, currency, source, owner_subject_id,
                      enquiry_payload, created_at, updated_at`,
          [id, accountId]
        );

        // 4. Create Agreement
        const agreementTitle = typeof body.agreementTitle === 'string' && body.agreementTitle.trim()
          ? body.agreementTitle.trim()
          : `Agreement: ${leadRow.title}`;
        const agreementVal = typeof body.agreementValueMinorUnits === 'number' && Number.isFinite(body.agreementValueMinorUnits)
          ? Math.round(body.agreementValueMinorUnits)
          : leadRow.amount_minor_units;

        const agrRes = await ctx.tx.query<{
          agreement_id: string;
          tenant_id: string;
          account_id: string;
          source_lead_id: string | null;
          title: string;
          status: string;
          value_minor_units: string | number | null;
          currency: string;
          starts_on: Date | string | null;
          ends_on: Date | string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_agreements (
             tenant_id, account_id, source_lead_id, title, status, value_minor_units, currency
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4, 'DRAFT', $5, $6
           ) RETURNING agreement_id, tenant_id, account_id, source_lead_id, title,
                     status, value_minor_units, currency, starts_on, ends_on, created_at, updated_at`,
          [ctx.membership.tenantId, accountId, id, agreementTitle, agreementVal, leadRow.currency]
        );

        // 5. Open Case if requested
        let caseRow: {
          case_id: string;
          tenant_id: string;
          account_id: string;
          contact_id: string | null;
          subject: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        } | null = null;
        if (body.openCase === true) {
          const caseSubject = typeof body.caseSubject === 'string' && body.caseSubject.trim()
            ? body.caseSubject.trim()
            : `Onboarding: ${leadRow.title}`;

          const cRes = await ctx.tx.query<{
            case_id: string;
            tenant_id: string;
            account_id: string;
            contact_id: string | null;
            subject: string;
            description: string | null;
            priority: string;
            status: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO platform.crm_cases (
               tenant_id, account_id, contact_id, subject, priority, status
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4, 'NORMAL', 'OPEN'
             ) RETURNING case_id, tenant_id, account_id, contact_id, subject, description,
                       priority, status, created_at, updated_at`,
            [ctx.membership.tenantId, accountId, leadRow.contact_id, caseSubject]
          );
          caseRow = cRes.rows[0]!;
        }

        return {
          lead: mapLead(wonRes.rows[0]!),
          account: mapAccount(accountRow),
          contact: contactRow ? mapContact(contactRow) : null,
          agreement: mapAgreement(agrRes.rows[0]!),
          case: caseRow ? mapCase(caseRow) : null,
        };
      },
    },

    // ---------------- Cases ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/cases',
      requires: ['crm.case.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const status = ctx.url.searchParams.get('status')?.trim() ?? '';
        const accountId = ctx.url.searchParams.get('accountId')?.trim() ?? '';

        const res = await ctx.tx.query<{
          case_id: string;
          tenant_id: string;
          account_id: string;
          contact_id: string | null;
          subject: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT case_id, tenant_id, account_id, contact_id, subject, description,
                  priority, status, created_at, updated_at
             FROM platform.crm_cases
            WHERE ($1 = '' OR status = $1)
              AND ($2 = '' OR account_id = $2::uuid)
            ORDER BY created_at DESC
            LIMIT $3`,
          [status, accountId, limit]
        );

        return {
          items: res.rows.map(mapCase),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/cases',
      requires: ['crm.case.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
        if (subject.length === 0 || subject.length > 200) {
          return refusal('REFUSED', ctx.traceId, 'Case subject must be 1-200 characters');
        }
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : null;
        if (!accountId) {
          return refusal('REFUSED', ctx.traceId, 'accountId is required');
        }
        const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : null;
        const description = typeof body.description === 'string' ? body.description.trim() : null;
        const priority = typeof body.priority === 'string' ? body.priority.trim().toUpperCase() : 'NORMAL';

        const res = await ctx.tx.query<{
          case_id: string;
          tenant_id: string;
          account_id: string;
          contact_id: string | null;
          subject: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_cases (tenant_id, account_id, contact_id, subject, description, priority, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'OPEN')
           RETURNING case_id, tenant_id, account_id, contact_id, subject, description,
                     priority, status, created_at, updated_at`,
          [ctx.membership.tenantId, accountId, contactId, subject, description, priority]
        );
        return mapCase(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/cases/:id',
      pattern: /^\/v1\/crm\/cases\/([0-9a-fA-F-]+)$/,
      requires: ['crm.case.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          case_id: string;
          tenant_id: string;
          account_id: string;
          contact_id: string | null;
          subject: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT case_id, tenant_id, account_id, contact_id, subject, description,
                  priority, status, created_at, updated_at
             FROM platform.crm_cases
            WHERE case_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapCase(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/crm/cases/:id',
      pattern: /^\/v1\/crm\/cases\/([0-9a-fA-F-]+)$/,
      requires: ['crm.case.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const subject = typeof body.subject === 'string' ? body.subject.trim() : undefined;
        const description = typeof body.description === 'string' ? body.description.trim() : undefined;
        const priority = typeof body.priority === 'string' ? body.priority.trim().toUpperCase() : undefined;
        const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;

        const res = await ctx.tx.query<{
          case_id: string;
          tenant_id: string;
          account_id: string;
          contact_id: string | null;
          subject: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_cases
              SET subject = COALESCE($2, subject),
                  description = COALESCE($3, description),
                  priority = COALESCE($4, priority),
                  status = COALESCE($5, status),
                  updated_at = now()
            WHERE case_id = $1::uuid
            RETURNING case_id, tenant_id, account_id, contact_id, subject, description,
                      priority, status, created_at, updated_at`,
          [id, subject ?? null, description ?? null, priority ?? null, status ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapCase(res.rows[0]!);
      },
    },

    // ---------------- Agreements ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/agreements',
      requires: ['crm.agreement.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const status = ctx.url.searchParams.get('status')?.trim() ?? '';
        const accountId = ctx.url.searchParams.get('accountId')?.trim() ?? '';

        const res = await ctx.tx.query<{
          agreement_id: string;
          tenant_id: string;
          account_id: string;
          source_lead_id: string | null;
          title: string;
          status: string;
          value_minor_units: string | number | null;
          currency: string;
          starts_on: Date | string | null;
          ends_on: Date | string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT agreement_id, tenant_id, account_id, source_lead_id, title,
                  status, value_minor_units, currency, starts_on, ends_on, created_at, updated_at
             FROM platform.crm_agreements
            WHERE ($1 = '' OR status = $1)
              AND ($2 = '' OR account_id = $2::uuid)
            ORDER BY created_at DESC
            LIMIT $3`,
          [status, accountId, limit]
        );

        return {
          items: res.rows.map(mapAgreement),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/crm/agreements',
      requires: ['crm.agreement.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (title.length === 0 || title.length > 200) {
          return refusal('REFUSED', ctx.traceId, 'Agreement title must be 1-200 characters');
        }
        const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : null;
        if (!accountId) {
          return refusal('REFUSED', ctx.traceId, 'accountId is required');
        }
        const sourceLeadId = typeof body.sourceLeadId === 'string' ? body.sourceLeadId.trim() : null;
        const valueMinorUnits = typeof body.valueMinorUnits === 'number' && Number.isFinite(body.valueMinorUnits)
          ? Math.round(body.valueMinorUnits)
          : null;
        const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : 'USD';
        const startsOn = typeof body.startsOn === 'string' ? body.startsOn.trim() : null;
        const endsOn = typeof body.endsOn === 'string' ? body.endsOn.trim() : null;

        const res = await ctx.tx.query<{
          agreement_id: string;
          tenant_id: string;
          account_id: string;
          source_lead_id: string | null;
          title: string;
          status: string;
          value_minor_units: string | number | null;
          currency: string;
          starts_on: Date | string | null;
          ends_on: Date | string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO platform.crm_agreements (
             tenant_id, account_id, source_lead_id, title, status, value_minor_units, currency, starts_on, ends_on
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4, 'DRAFT', $5, $6, $7::date, $8::date
           ) RETURNING agreement_id, tenant_id, account_id, source_lead_id, title,
                     status, value_minor_units, currency, starts_on, ends_on, created_at, updated_at`,
          [ctx.membership.tenantId, accountId, sourceLeadId, title, valueMinorUnits, currency, startsOn, endsOn]
        );
        return mapAgreement(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/crm/agreements/:id',
      pattern: /^\/v1\/crm\/agreements\/([0-9a-fA-F-]+)$/,
      requires: ['crm.agreement.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          agreement_id: string;
          tenant_id: string;
          account_id: string;
          source_lead_id: string | null;
          title: string;
          status: string;
          value_minor_units: string | number | null;
          currency: string;
          starts_on: Date | string | null;
          ends_on: Date | string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT agreement_id, tenant_id, account_id, source_lead_id, title,
                  status, value_minor_units, currency, starts_on, ends_on, created_at, updated_at
             FROM platform.crm_agreements
            WHERE agreement_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapAgreement(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/crm/agreements/:id',
      pattern: /^\/v1\/crm\/agreements\/([0-9a-fA-F-]+)$/,
      requires: ['crm.agreement.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;
        const valueMinorUnits = typeof body.valueMinorUnits === 'number' && Number.isFinite(body.valueMinorUnits)
          ? Math.round(body.valueMinorUnits)
          : undefined;

        const res = await ctx.tx.query<{
          agreement_id: string;
          tenant_id: string;
          account_id: string;
          source_lead_id: string | null;
          title: string;
          status: string;
          value_minor_units: string | number | null;
          currency: string;
          starts_on: Date | string | null;
          ends_on: Date | string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.crm_agreements
              SET title = COALESCE($2, title),
                  status = COALESCE($3, status),
                  value_minor_units = COALESCE($4, value_minor_units),
                  updated_at = now()
            WHERE agreement_id = $1::uuid
            RETURNING agreement_id, tenant_id, account_id, source_lead_id, title,
                      status, value_minor_units, currency, starts_on, ends_on, created_at, updated_at`,
          [id, title ?? null, status ?? null, valueMinorUnits ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapAgreement(res.rows[0]!);
      },
    },
  ];
}
