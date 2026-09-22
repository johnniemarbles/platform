import type { AuthorizationDecision } from '@platform-core/authorization';

export interface AuthorizationAuditEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly decision: AuthorizationDecision;
  readonly recordedAt: string;
}

export interface AuthorizationAuditSink {
  record(event: AuthorizationAuditEvent): Promise<void>;
}

export class LoggingAuthorizationSink implements AuthorizationAuditSink {
  async record(event: AuthorizationAuditEvent): Promise<void> {
    const level = event.decision.allowed ? 'INFO' : 'WARN';
    console.log(`[AUTH_AUDIT] [${level}] ${event.eventId} - Tenant: ${event.tenantId}, Subject: ${event.subjectId}, Action: ${event.action} on ${event.resourceType}${event.resourceId ? `:${event.resourceId}` : ''}`);
    if (!event.decision.allowed) {
      console.log(`[AUTH_AUDIT] [DENIAL] Stage: ${event.decision.stage}, ReasonKey: ${event.decision.reasonKey} - ${event.decision.reason}`);
    }
  }
}
