/**
 * ADR-018 scheduling domain types — pure shapes, no persistence.
 */

import type { AppointmentState } from './states.ts';

export const PARTICIPANT_ROLES = [
  'PRIMARY',
  'DEPENDENT',
  'GUARDIAN',
  'REFERRER',
  'ATTENDEE',
  'HOST',
  'ORG_CONTACT',
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const ATTENDANCE_STATUSES = [
  'UNKNOWN',
  'EXPECTED',
  'CHECKED_IN',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const RESOURCE_CAPACITY_MODES = ['EXCLUSIVE', 'CAPACITY_N'] as const;
export type ResourceCapacityMode = (typeof RESOURCE_CAPACITY_MODES)[number];

export const LOCATION_KINDS = ['PHYSICAL', 'VIRTUAL', 'HYBRID'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Snapshotted service config stored on the appointment at book/confirm. */
export interface ServiceSnapshot {
  readonly serviceId: string;
  readonly displayName: string;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly capacityUnits: number;
  readonly attributesSchemaVersion: number;
}

export interface SchedulingService {
  readonly serviceId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly key: string;
  readonly displayName: string;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly capacityUnits: number;
  readonly active: boolean;
  readonly attributes: Record<string, unknown>;
  readonly attributesSchemaVersion: number;
}

export interface SchedulingResource {
  readonly resourceId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly key: string;
  readonly displayName: string;
  readonly capacityMode: ResourceCapacityMode;
  readonly capacityN: number;
  readonly timezone: string | null;
  readonly active: boolean;
}

export interface SchedulingLocation {
  readonly locationId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly key: string;
  readonly displayName: string;
  readonly kind: LocationKind;
  readonly timezone: string | null;
  readonly active: boolean;
}

export interface AppointmentParticipant {
  readonly participantId: string;
  readonly appointmentId: string;
  readonly partyId: string;
  readonly roleKey: ParticipantRole;
  readonly attendanceStatus: AttendanceStatus;
  readonly attributes: Record<string, unknown>;
}

export interface SchedulingAppointment {
  readonly appointmentId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly serviceId: string;
  readonly resourceId: string;
  readonly locationId: string | null;
  readonly status: AppointmentState;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly bookingTimezone: string;
  readonly serviceSnapshot: ServiceSnapshot;
  readonly attributes: Record<string, unknown>;
  readonly attributesSchemaVersion: number;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SlotHold {
  readonly holdId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly serviceId: string;
  readonly resourceId: string;
  readonly locationId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
}
