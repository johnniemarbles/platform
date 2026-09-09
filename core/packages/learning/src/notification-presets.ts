export type LearningNotificationPresetKey =
  | 'learning.enrollment.assigned.email'
  | 'learning.course.completed.email'
  | 'learning.course.certificate.issued.email'
  | 'learning.assignment.graded.email'
  | 'learning.assignment.returned.email'
  | 'learning.credential.issued.email'
  | 'learning.credential.expiring.email'
  | 'learning.credential.expired.email';

export type LearningNotificationBindingKind =
  | 'EVENT_PAYLOAD'
  | 'AGGREGATE_FIELD';

export interface LearningNotificationValueBinding {
  readonly kind: LearningNotificationBindingKind;
  readonly key: string;
  readonly required?: boolean;
}

export interface LearningNotificationPreset {
  readonly presetKey: LearningNotificationPresetKey;
  readonly label: string;
  readonly description: string;
  readonly eventType: string;
  readonly ruleKey: string;
  readonly triggerKey: string;
  readonly actionKey: string;
  readonly channel: 'email';
  readonly purpose: 'transactional';
  readonly consentRequired: false;
  readonly recipient: {
    readonly email: LearningNotificationValueBinding;
  };
  readonly variables: Readonly<Record<string, LearningNotificationValueBinding>>;
  readonly requiredVariables: readonly string[];
  readonly subject: string;
  readonly body: string;
}

const learnerRecipient = {
  email: { kind: 'AGGREGATE_FIELD', key: 'learnerEmail' },
} as const;

const baseVariables = {
  learnerName: { kind: 'AGGREGATE_FIELD', key: 'learnerName', required: false },
  learnerEmail: { kind: 'AGGREGATE_FIELD', key: 'learnerEmail', required: false },
} as const;

const courseVariables = {
  ...baseVariables,
  courseId: { kind: 'EVENT_PAYLOAD', key: 'courseId' },
  courseKey: { kind: 'EVENT_PAYLOAD', key: 'courseKey', required: false },
  courseVersionId: { kind: 'EVENT_PAYLOAD', key: 'courseVersionId', required: false },
  courseVersion: { kind: 'EVENT_PAYLOAD', key: 'courseVersion', required: false },
} as const;

export const LEARNING_NOTIFICATION_PRESETS: readonly LearningNotificationPreset[] = [
  {
    presetKey: 'learning.enrollment.assigned.email',
    label: 'Enrollment assigned',
    description: 'Tell a learner when an administrator assigns a course.',
    eventType: 'learning.enrollment.created',
    ruleKey: 'learning.notify.enrollment.assigned.email',
    triggerKey: 'learning.enrollment.assigned',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      enrollmentId: { kind: 'AGGREGATE_FIELD', key: 'eventAggregateId' },
      courseId: { kind: 'EVENT_PAYLOAD', key: 'courseId' },
      courseVersionId: { kind: 'EVENT_PAYLOAD', key: 'courseVersionId' },
      courseVersion: { kind: 'EVENT_PAYLOAD', key: 'courseVersion', required: false },
      sourceType: { kind: 'EVENT_PAYLOAD', key: 'sourceType', required: false },
    },
    requiredVariables: ['learnerName', 'courseId', 'enrollmentId'],
    subject: 'You have a new EXPADIO learning assignment',
    body: 'Hi {{learnerName}}, you have been assigned a new course in EXPADIO Learning. Course: {{courseId}}. Open your Learning workspace to begin.',
  },
  {
    presetKey: 'learning.course.completed.email',
    label: 'Course completed',
    description: 'Confirm course completion after all required lessons, assessments and assignments are satisfied.',
    eventType: 'learning.course.completed',
    ruleKey: 'learning.notify.course.completed.email',
    triggerKey: 'learning.course.completed',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...courseVariables,
      enrollmentId: { kind: 'AGGREGATE_FIELD', key: 'eventAggregateId' },
      completionPercent: { kind: 'EVENT_PAYLOAD', key: 'completionPercent', required: false },
    },
    requiredVariables: ['learnerName', 'courseId', 'completionPercent'],
    subject: 'Course completed',
    body: 'Congratulations {{learnerName}} — you completed {{courseKey}} at {{completionPercent}}%. Your transcript has been updated in EXPADIO Learning.',
  },
  {
    presetKey: 'learning.course.certificate.issued.email',
    label: 'Course certificate issued',
    description: 'Tell a learner when a certificate-enabled course issues a course certificate.',
    eventType: 'learning.course.certificate.issued',
    ruleKey: 'learning.notify.course.certificate.issued.email',
    triggerKey: 'learning.course.certificate.issued',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...courseVariables,
      certificateKey: { kind: 'EVENT_PAYLOAD', key: 'certificateKey' },
      enrollmentId: { kind: 'EVENT_PAYLOAD', key: 'enrollmentId' },
    },
    requiredVariables: ['learnerName', 'certificateKey', 'courseId'],
    subject: 'Your course certificate is ready',
    body: 'Hi {{learnerName}}, your certificate for {{courseKey}} is ready. Certificate key: {{certificateKey}}. View it from your EXPADIO Learning credentials.',
  },
  {
    presetKey: 'learning.assignment.graded.email',
    label: 'Assignment graded',
    description: 'Notify a learner when an assignment submission is graded.',
    eventType: 'learning.assignment.graded',
    ruleKey: 'learning.notify.assignment.graded.email',
    triggerKey: 'learning.assignment.graded',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      submissionId: { kind: 'AGGREGATE_FIELD', key: 'eventAggregateId' },
      assignmentTitle: { kind: 'AGGREGATE_FIELD', key: 'assignmentTitle', required: false },
      enrollmentId: { kind: 'AGGREGATE_FIELD', key: 'assignmentEnrollmentId', required: false },
      scorePoints: { kind: 'EVENT_PAYLOAD', key: 'scorePoints', required: false },
      maxPoints: { kind: 'EVENT_PAYLOAD', key: 'maxPoints', required: false },
    },
    requiredVariables: ['learnerName', 'scorePoints', 'maxPoints'],
    subject: 'Your assignment has been graded',
    body: 'Hi {{learnerName}}, your assignment {{assignmentTitle}} has been graded: {{scorePoints}} out of {{maxPoints}}. Review feedback in EXPADIO Learning.',
  },
  {
    presetKey: 'learning.assignment.returned.email',
    label: 'Assignment returned',
    description: 'Notify a learner when an assignment submission is returned for revision.',
    eventType: 'learning.assignment.returned',
    ruleKey: 'learning.notify.assignment.returned.email',
    triggerKey: 'learning.assignment.returned',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      submissionId: { kind: 'AGGREGATE_FIELD', key: 'eventAggregateId' },
      assignmentTitle: { kind: 'AGGREGATE_FIELD', key: 'assignmentTitle', required: false },
      enrollmentId: { kind: 'AGGREGATE_FIELD', key: 'assignmentEnrollmentId', required: false },
    },
    requiredVariables: ['learnerName', 'assignmentTitle'],
    subject: 'Your assignment needs updates',
    body: 'Hi {{learnerName}}, your assignment {{assignmentTitle}} was returned with feedback. Open EXPADIO Learning to review the requested updates.',
  },
  {
    presetKey: 'learning.credential.issued.email',
    label: 'Credential issued',
    description: 'Tell a learner when a program certification issues a credential.',
    eventType: 'learning.credential.issued',
    ruleKey: 'learning.notify.credential.issued.email',
    triggerKey: 'learning.credential.issued',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      credentialKey: { kind: 'EVENT_PAYLOAD', key: 'credentialKey' },
      certificationId: { kind: 'EVENT_PAYLOAD', key: 'certificationId', required: false },
      certificationVersionId: { kind: 'EVENT_PAYLOAD', key: 'certificationVersionId', required: false },
      expiresAt: { kind: 'EVENT_PAYLOAD', key: 'expiresAt', required: false },
      renewalDueAt: { kind: 'EVENT_PAYLOAD', key: 'renewalDueAt', required: false },
    },
    requiredVariables: ['learnerName', 'credentialKey'],
    subject: 'Your EXPADIO credential has been issued',
    body: 'Congratulations {{learnerName}} — your credential {{credentialKey}} has been issued. View renewal and expiry details in EXPADIO Learning.',
  },
  {
    presetKey: 'learning.credential.expiring.email',
    label: 'Credential expiring',
    description: 'Warn a learner when a credential enters its renewal window.',
    eventType: 'learning.credential.expiring',
    ruleKey: 'learning.notify.credential.expiring.email',
    triggerKey: 'learning.credential.expiring',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      credentialKey: { kind: 'EVENT_PAYLOAD', key: 'credentialKey' },
      certificationId: { kind: 'EVENT_PAYLOAD', key: 'certificationId', required: false },
      certificationVersionId: { kind: 'EVENT_PAYLOAD', key: 'certificationVersionId', required: false },
      expiresAt: { kind: 'EVENT_PAYLOAD', key: 'expiresAt', required: false },
      renewalDueAt: { kind: 'EVENT_PAYLOAD', key: 'renewalDueAt', required: false },
    },
    requiredVariables: ['learnerName', 'credentialKey', 'expiresAt'],
    subject: 'Credential renewal required soon',
    body: 'Hi {{learnerName}}, credential {{credentialKey}} is approaching expiry on {{expiresAt}}. Complete renewal activity in EXPADIO Learning.',
  },
  {
    presetKey: 'learning.credential.expired.email',
    label: 'Credential expired',
    description: 'Tell a learner when a credential has expired.',
    eventType: 'learning.credential.expired',
    ruleKey: 'learning.notify.credential.expired.email',
    triggerKey: 'learning.credential.expired',
    actionKey: 'learning.notification.email',
    channel: 'email',
    purpose: 'transactional',
    consentRequired: false,
    recipient: learnerRecipient,
    variables: {
      ...baseVariables,
      credentialKey: { kind: 'EVENT_PAYLOAD', key: 'credentialKey' },
      certificationId: { kind: 'EVENT_PAYLOAD', key: 'certificationId', required: false },
      certificationVersionId: { kind: 'EVENT_PAYLOAD', key: 'certificationVersionId', required: false },
      expiresAt: { kind: 'EVENT_PAYLOAD', key: 'expiresAt', required: false },
      renewalDueAt: { kind: 'EVENT_PAYLOAD', key: 'renewalDueAt', required: false },
    },
    requiredVariables: ['learnerName', 'credentialKey', 'expiresAt'],
    subject: 'Credential expired',
    body: 'Hi {{learnerName}}, credential {{credentialKey}} expired on {{expiresAt}}. Open EXPADIO Learning to review renewal options.',
  },
] as const;

export function listLearningNotificationPresets(): readonly LearningNotificationPreset[] {
  return LEARNING_NOTIFICATION_PRESETS;
}

export function findLearningNotificationPreset(
  presetKey: LearningNotificationPresetKey,
): LearningNotificationPreset {
  const preset = LEARNING_NOTIFICATION_PRESETS.find((item) => item.presetKey === presetKey);
  if (preset === undefined) {
    throw new Error('LEARNING_NOTIFICATION_PRESET_NOT_FOUND');
  }
  return preset;
}

export function isLearningNotificationPresetKey(
  value: unknown,
): value is LearningNotificationPresetKey {
  return typeof value === 'string'
    && LEARNING_NOTIFICATION_PRESETS.some((preset) => preset.presetKey === value);
}
