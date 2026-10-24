import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from '../../../apps/platform-api/test/helpers/harness.ts';
import type { Transport } from '@platform-sdk/transport';
import { assertShape } from '../../transport/src/test-utils.ts';
import { schedulingClient } from '../src/index.ts';

test('scheduling sdk: contract test against real platform-api', async () => {
  const harness = await setupHarness('dentex');
  const owner = await harness.asRole('owner');

  const transport: Transport = {
    async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      const res = await owner.request(method, path, body);
      if (res.status >= 400) {
        throw new Error(`request failed with status ${res.status}`);
      }
      return res.body.result;
    },
  };

  const client = schedulingClient(transport);

  const initialList = await client.listBookings();
  assert.ok(Array.isArray(initialList));

  const newBooking = await client.createBooking({
    patientName: 'Jane Doe',
    patientEmail: 'jane@example.com',
    patientPhone: '+1-555-0199',
    serviceKey: 'checkup',
    chairId: 'chair-1',
    startsAt: '2026-11-01T10:00:00Z',
    endsAt: '2026-11-01T11:00:00Z',
    chiefComplaint: 'Toothache',
  });

  assertShape(newBooking, {
    bookingId: 'string',
    status: 'string',
    patientName: 'string',
    patientEmail: 'string',
    serviceKey: 'string',
    chairId: 'string',
  });

  const afterList = await client.listBookings();
  assert.ok(afterList.length > 0);
  assertShape(afterList[0], {
    bookingId: 'string',
    status: 'string',
    patientName: 'string',
    patientEmail: 'string',
  });

  await harness.close();
});
