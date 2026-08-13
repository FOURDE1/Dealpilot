import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Conversation,
  ConversationAnalysisRecord,
  Message,
  SendResult,
  paginated,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedConversations = paginated(Conversation);
const PaginatedMessages = paginated(Message);
const ConversationDetail = z.object({
  conversation: Conversation,
  analysis: z.array(ConversationAnalysisRecord),
});

export const conversationKeys = {
  all: ['conversations'] as const,
  list: (orgId: string | undefined, status: string) =>
    ['conversations', 'list', orgId ?? 'single-org', status] as const,
  detail: (id: string) => ['conversations', 'detail', id] as const,
  thread: (id: string) => ['conversations', 'thread', id] as const,
};

export function useConversations(
  orgId?: string,
  opts?: { enabled?: boolean; status?: string },
) {
  return useQuery({
    queryKey: conversationKeys.list(orgId, opts?.status ?? ''),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.conversations.list, {
        query: {
          organization_id: orgId,
          limit: 50,
          ...(opts?.status ? { status: opts.status } : {}),
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedConversations.parse(res.body);
    },
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: conversationKeys.detail(id ?? ''),
    enabled: !!id,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.conversations.get, { params: { id: id! }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return ConversationDetail.parse(res.body);
    },
  });
}

/**
 * The thread, oldest at the bottom.
 *
 * The API pages newest-first (one keyset helper, one direction). A conversation
 * reads the other way round, so the reversal happens here rather than in a
 * second server sort — the page the agent is looking at is the newest one
 * either way.
 */
export function useThread(id: string | null) {
  return useQuery({
    queryKey: conversationKeys.thread(id ?? ''),
    enabled: !!id,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.conversations.messages, {
        params: { id: id! }, query: { limit: 100 }, signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      const parsed = PaginatedMessages.parse(res.body);
      return { ...parsed, items: [...parsed.items].reverse() };
    },
  });
}

/**
 * Send a reply.
 *
 * A refusal is a 200 with a `kind`, not a thrown error, so this resolves for
 * every answer the gate can give. The screen renders the reason; the mutation
 * has nothing to apologise for.
 */
export function useSendReply(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest(routes.conversations.reply, {
        params: { id: conversationId }, body: { body },
      });
      if (res.status !== 200) fail(res.status, res.body);
      return SendResult.parse(res.body);
    },
    onSuccess: (result) => {
      if (result.kind !== 'sent') return;
      void qc.invalidateQueries({ queryKey: conversationKeys.thread(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

export function useTakeover(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(routes.conversations.takeover, {
        params: { id: conversationId }, body: {},
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Conversation.parse(res.body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

export function useCloseConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason?: string) => {
      const res = await apiRequest(routes.conversations.close, {
        params: { id: conversationId }, body: reason ? { reason } : {},
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Conversation.parse(res.body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}
