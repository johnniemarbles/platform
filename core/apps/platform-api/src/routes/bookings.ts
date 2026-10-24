import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { HandlerContext, RouteDefinition } from '../handler.ts';
import { refusal } from '../contracts.ts';
import { mintScopeToken, signerFromEnv, type ScopeTokenSignerConfig } from '../scope-token.ts';

export interface CreateBookingBody {
  readonly patientName: string;
  readonly patientEmail: string;
  readonly patientPhone?: string;
  readonly serviceKey?: string;
  readonly chairId?: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly chiefComplaint?: string;
}

export interface BookingRow {
  readonly booking_id: string;
  readonly tenant_id: string;
  readonly app_id: string;
  readonly patient_name: string;
  readonly patient_email: string;
  readonly patient_phone: string | null;
  readonly service_key: string;
  readonly chair_id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly status: string;
  readonly chief_complaint: string | null;
  readonly created_at: Date;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export interface BookingsRouteOptions {
  readonly signerConfig?: ScopeTokenSignerConfig;
  readonly hubBaseUrl?: string;
  readonly dispatchEmail?: (options: {
    hubBaseUrl: string;
    scopeToken: string;
    to: string;
    templateKey: string;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<{ ok: boolean }>;
}

export function bookingsRoutes(appId: string, options: BookingsRouteOptions = {}): readonly RouteDefinition[] {
  const getSigner = () => options.signerConfig ?? signerFromEnv();
  const hubBaseUrl = options.hubBaseUrl ?? process.env['HUB_BASE_URL'];

  return [
    {
      method: 'POST',
      path: '/v1/bookings',
      appId,
      requires: ['bookings.create'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = (await readJson(req)) as unknown as CreateBookingBody;
        if (!body.patientName || !body.patientEmail || !body.startsAt || !body.endsAt) {
          return refusal('REFUSED', ctx.traceId, 'missing required fields: patientName, patientEmail, startsAt, endsAt');
        }

        const startsAt = new Date(body.startsAt);
        const endsAt = new Date(body.endsAt);
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
          return refusal('REFUSED', ctx.traceId, 'invalid dates: endsAt must be after startsAt');
        }

        const res = await ctx.tx.query<BookingRow>(`
          INSERT INTO platform.bookings (
            tenant_id, app_id, patient_name, patient_email, patient_phone,
            service_key, chair_id, starts_at, ends_at, status, chief_complaint, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $10, $11
          ) RETURNING *;
        `, [
          ctx.membership.tenantId,
          ctx.membership.appId,
          body.patientName.trim(),
          body.patientEmail.trim().toLowerCase(),
          body.patientPhone?.trim() ?? null,
          body.serviceKey ?? 'general-checkup',
          body.chairId ?? 'chair-1',
          startsAt.toISOString(),
          endsAt.toISOString(),
          body.chiefComplaint?.trim() ?? null,
          ctx.membership.personId,
        ]);

        const booking = res.rows[0]!;

        // Mint least-privilege scope token for hub-api communication dispatch
        try {
          const signer = getSigner();
          const scopeToken = mintScopeToken(signer, {
            membership: ctx.membership,
            credentialClass: 'platform-operational',
            permissions: ['communication.email.send'],
          });

          if (options.dispatchEmail) {
            await options.dispatchEmail({
              hubBaseUrl: hubBaseUrl ?? 'http://127.0.0.1:8080',
              scopeToken,
              to: booking.patient_email,
              templateKey: 'sched.appointment.confirmed',
              parameters: {
                serviceName: booking.service_key,
                startsAt: booking.starts_at.toISOString(),
                endsAt: booking.ends_at.toISOString(),
                timezone: 'UTC',
                appointmentId: booking.booking_id,
                manageUrl: `/book/manage?id=${booking.booking_id}`,
                managementToken: randomUUID(),
              },
              idempotencyKey: `booking_${booking.booking_id}`,
              traceId: ctx.traceId,
            });
          }
        } catch {
          // In test mode or when signer is not configured, continue without failing booking
        }

        return {
          bookingId: booking.booking_id,
          status: booking.status,
          patientName: booking.patient_name,
          patientEmail: booking.patient_email,
          serviceKey: booking.service_key,
          chairId: booking.chair_id,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          createdAt: booking.created_at,
        };
      },
    },
    {
      method: 'GET',
      path: '/v1/bookings',
      appId,
      requires: ['bookings.read'],
      handler: async (ctx: HandlerContext) => {
        const res = await ctx.tx.query<BookingRow>(`
          SELECT booking_id, patient_name, patient_email, patient_phone,
                 service_key, chair_id, starts_at, ends_at, status, chief_complaint, created_at
          FROM platform.bookings
          WHERE app_id = $1
          ORDER BY starts_at DESC
          LIMIT 50;
        `, [ctx.membership.appId]);

        return res.rows.map((r) => ({
          bookingId: r.booking_id,
          patientName: r.patient_name,
          patientEmail: r.patient_email,
          patientPhone: r.patient_phone,
          serviceKey: r.service_key,
          chairId: r.chair_id,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          status: r.status,
          chiefComplaint: r.chief_complaint,
          createdAt: r.created_at,
        }));
      },
    },
  ];
}
