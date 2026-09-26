/**
 * ADR-018 Phase G — neutral communication presets for scheduling lifecycle.
 * Templates + governed COMMUNICATE intents use these trigger keys.
 * Industry packs may later relabel copy; keys stay stable.
 */

export const SCHEDULING_NOTIFICATION_PRESET_KEYS = [
  'CONFIRMATION',
  'REMINDER',
  'RESCHEDULE',
  'CANCELLATION',
  'NO_SHOW',
] as const;

export type SchedulingNotificationPresetKey =
  (typeof SCHEDULING_NOTIFICATION_PRESET_KEYS)[number];

export function isSchedulingNotificationPresetKey(
  value: unknown,
): value is SchedulingNotificationPresetKey {
  return (
    typeof value === 'string'
    && (SCHEDULING_NOTIFICATION_PRESET_KEYS as readonly string[]).includes(value)
  );
}

export interface SchedulingNotificationPreset {
  readonly presetKey: SchedulingNotificationPresetKey;
  readonly label: string;
  readonly description: string;
  /** Domain event type emitted with the appointment lifecycle. */
  readonly eventType: string;
  /** communication_templates.trigger_key */
  readonly triggerKey: string;
  readonly actionKey: string;
  readonly ruleKey: string;
  readonly channel: 'email';
  readonly purpose: 'transactional';
  /** Transactional booking notices — consent not required for send path. */
  readonly consentRequired: false;
  readonly subject: string;
  readonly body: string;
  readonly requiredVariables: readonly string[];
}

export const SCHEDULING_NOTIFICATION_PRESETS: readonly SchedulingNotificationPreset[] = [
  {
    presetKey: 'CONFIRMATION',
    label: 'Appointment confirmation',
    description: 'Sent when an appointment is confirmed.',
    eventType: 'sched.appointment.confirmed',
    triggerKey: 'sched.appointment.confirmed',
    actionKey: 'sched.notify.confirmation',
    ruleKey: 'sched.notify.confirmation',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    subject: 'Your appointment is confirmed',
    body: [
      'Your appointment is confirmed.',
      '',
      'Service: {{serviceName}}',
      'When: {{startsAt}} – {{endsAt}} ({{timezone}})',
      'Reference: {{appointmentId}}',
      '',
      'Manage or cancel: {{manageUrl}}',
      'If the link does not work, open /book/manage and paste this token:',
      '{{managementToken}}',
    ].join('\n'),
    requiredVariables: [
      'serviceName',
      'startsAt',
      'endsAt',
      'timezone',
      'appointmentId',
      'manageUrl',
      'managementToken',
    ],
  },
  {
    presetKey: 'REMINDER',
    label: 'Appointment reminder',
    description: 'Sent ahead of a confirmed appointment (scheduler / ops).',
    eventType: 'sched.appointment.reminder',
    triggerKey: 'sched.appointment.reminder',
    actionKey: 'sched.notify.reminder',
    ruleKey: 'sched.notify.reminder',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    subject: 'Reminder: upcoming appointment',
    body: [
      'This is a reminder of your upcoming appointment.',
      '',
      'Service: {{serviceName}}',
      'When: {{startsAt}} – {{endsAt}} ({{timezone}})',
      'Reference: {{appointmentId}}',
      '',
      'Manage or cancel: {{manageUrl}}',
      'Token: {{managementToken}}',
    ].join('\n'),
    requiredVariables: [
      'serviceName',
      'startsAt',
      'endsAt',
      'timezone',
      'appointmentId',
      'manageUrl',
      'managementToken',
    ],
  },
  {
    presetKey: 'RESCHEDULE',
    label: 'Appointment reschedule',
    description: 'Sent when an appointment is moved to a new time.',
    eventType: 'sched.appointment.rescheduled',
    triggerKey: 'sched.appointment.rescheduled',
    actionKey: 'sched.notify.reschedule',
    ruleKey: 'sched.notify.reschedule',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    subject: 'Your appointment was rescheduled',
    body: [
      'Your appointment was rescheduled.',
      '',
      'Service: {{serviceName}}',
      'New time: {{startsAt}} – {{endsAt}} ({{timezone}})',
      'Reference: {{appointmentId}}',
      '',
      'Manage or cancel: {{manageUrl}}',
      'If the link does not work, open /book/manage and paste this token:',
      '{{managementToken}}',
    ].join('\n'),
    requiredVariables: [
      'serviceName',
      'startsAt',
      'endsAt',
      'timezone',
      'appointmentId',
      'manageUrl',
      'managementToken',
    ],
  },
  {
    presetKey: 'CANCELLATION',
    label: 'Appointment cancellation',
    description: 'Sent when an appointment is cancelled.',
    eventType: 'sched.appointment.cancelled',
    triggerKey: 'sched.appointment.cancelled',
    actionKey: 'sched.notify.cancellation',
    ruleKey: 'sched.notify.cancellation',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    subject: 'Your appointment was cancelled',
    body: [
      'Your appointment was cancelled.',
      '',
      'Service: {{serviceName}}',
      'When: {{startsAt}} – {{endsAt}} ({{timezone}})',
      'Reference: {{appointmentId}}',
      '{{#reason}}Reason: {{reason}}{{/reason}}',
    ].join('\n'),
    requiredVariables: ['serviceName', 'startsAt', 'endsAt', 'timezone', 'appointmentId'],
  },
  {
    presetKey: 'NO_SHOW',
    label: 'No-show follow-up',
    description: 'Sent after an appointment is marked no-show.',
    eventType: 'sched.appointment.no_show',
    triggerKey: 'sched.appointment.no_show',
    actionKey: 'sched.notify.no_show',
    ruleKey: 'sched.notify.no_show',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    subject: 'We missed you',
    body: [
      'You were marked as a no-show for your appointment.',
      '',
      'Service: {{serviceName}}',
      'When: {{startsAt}} – {{endsAt}} ({{timezone}})',
      'Reference: {{appointmentId}}',
      'Contact us if you need to rebook.',
    ].join('\n'),
    requiredVariables: ['serviceName', 'startsAt', 'endsAt', 'timezone', 'appointmentId'],
  },
] as const;

export function getSchedulingNotificationPreset(
  key: SchedulingNotificationPresetKey,
): SchedulingNotificationPreset {
  const found = SCHEDULING_NOTIFICATION_PRESETS.find((p) => p.presetKey === key);
  if (!found) throw new Error(`Unknown scheduling notification preset: ${key}`);
  return found;
}

/** Absolute or path manage URL for public cancel/reschedule. */
export function buildSchedulingManageUrl(
  managementToken: string,
  publicOrigin?: string | null,
): string {
  const token = encodeURIComponent(managementToken);
  const origin = (publicOrigin ?? process.env.NEXT_PUBLIC_BRAND_WEB_URL ?? '')
    .trim()
    .replace(/\/$/, '');
  if (origin) return `${origin}/book/manage?token=${token}`;
  return `/book/manage?token=${token}`;
}
