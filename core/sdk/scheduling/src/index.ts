import type { Transport } from '@platform-sdk/transport';

export interface CreateBookingInput {
  readonly patientName: string;
  readonly patientEmail: string;
  readonly patientPhone?: string;
  readonly serviceKey?: string;
  readonly chairId?: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly chiefComplaint?: string;
}

export interface Booking {
  readonly bookingId: string;
  readonly status: string;
  readonly patientName: string;
  readonly patientEmail: string;
  readonly patientPhone?: string | null;
  readonly serviceKey: string;
  readonly chairId: string;
  readonly startsAt: string | Date;
  readonly endsAt: string | Date;
  readonly chiefComplaint?: string | null;
  readonly createdAt: string | Date;
}

export interface SchedulingClient {
  listBookings(): Promise<readonly Booking[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
}

export function schedulingClient(t: Transport): SchedulingClient {
  return {
    listBookings: () => t.request<readonly Booking[]>('GET', '/v1/bookings'),
    createBooking: (input: CreateBookingInput) => t.request<Booking>('POST', '/v1/bookings', input),
  };
}
