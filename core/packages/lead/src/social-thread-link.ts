/** Attach a Unibox/social thread to a CRM lead in metadata. No second CRM. */

export function socialThreadLeadMetadata(input: {
  readonly threadId: string;
  readonly provider?: string;
  readonly crmLeadId?: string | null;
}): Record<string, string> {
  const threadId = input.threadId.trim();
  if (threadId === '') {
    throw new Error('SOCIAL_THREAD_ID_REQUIRED');
  }
  const metadata: Record<string, string> = {
    socialThreadId: threadId,
    ...(input.provider ? { socialProvider: input.provider } : {}),
  };
  if (input.crmLeadId && input.crmLeadId.trim() !== '') {
    metadata.crmLeadId = input.crmLeadId.trim();
    metadata.leadHref = `/leads?leadId=${encodeURIComponent(input.crmLeadId.trim())}`;
  }
  return metadata;
}
