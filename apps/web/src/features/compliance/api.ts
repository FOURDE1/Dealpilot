import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ComplianceCheck,
  ConsentRecord,
  RecordConsentInput,
  SuppressionRecord,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/**
 * F-15 compliance, from the browser.
 *
 * The check endpoint runs the SAME function the send layer runs, on the same
 * facts. That matters more than it looks: a screen that says "ready to send"
 * while the server refuses is worse than no screen at all, because it teaches
 * staff that the rule is arbitrary.
 */

export const complianceKeys = {
  consent: (leadId: string) => ['compliance', 'consent', leadId] as const,
  check: (leadId: string, channel: string) => ['compliance', 'check', leadId, channel] as const,
};

export function useLeadConsent(leadId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: complianceKeys.consent(leadId),
    enabled: (opts?.enabled ?? true) && leadId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.compliance.forLead, { params: { id: leadId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return z.object({ items: z.array(ConsentRecord) }).parse(res.body).items;
    },
  });
}

/**
 * May we contact this lead right now?
 *
 * Not cached for long: the answer changes at 21:00 without anybody clicking
 * anything, and a stale "yes" on screen at 21:05 is exactly the wrong kind of
 * wrong.
 */
export function useComplianceCheck(
  leadId: string,
  query: { channel?: 'sms' | 'voice' | 'email'; scope?: 'conversational' | 'marketing' | 'ai_outbound_call' },
  opts?: { enabled?: boolean },
) {
  const channel = query.channel ?? 'sms';
  return useQuery({
    queryKey: complianceKeys.check(leadId, `${channel}:${query.scope ?? 'conversational'}`),
    enabled: (opts?.enabled ?? true) && leadId !== '',
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.compliance.check, {
        params: { id: leadId },
        query: { channel, scope: query.scope ?? 'conversational', originator: 'human' },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return ComplianceCheck.parse(res.body);
    },
  });
}

export function useRecordConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof RecordConsentInput>) => {
      const res = await apiRequest(routes.compliance.recordConsent, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return z.array(ConsentRecord).parse(res.body);
    },
    onSuccess: () => {
      // Prefix invalidation: recording consent changes both what we hold AND
      // whether we may send, and forgetting the second is how the panel ends up
      // showing a fresh consent beside a stale refusal.
      void queryClient.invalidateQueries({ queryKey: ['compliance'] });
    },
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: 'staff_manual' | 'said_stop_extracted' }) => {
      const res = await apiRequest(routes.compliance.revokeConsent, { params: { id }, body: { reason } });
      if (res.status !== 200) fail(res.status, res.body);
      return ConsentRecord.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['compliance'] }),
  });
}

export function useSuppress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { organization_id: string; phone_e164: string; channel: 'sms' | 'voice' | 'email' }) => {
      const res = await apiRequest(routes.compliance.suppress, {
        body: { ...body, source: 'staff_manual' as const },
      });
      if (res.status !== 201) fail(res.status, res.body);
      return SuppressionRecord.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['compliance'] }),
  });
}
