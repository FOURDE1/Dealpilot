import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * F-69 — the request's method and routed path, reachable from any depth of
 * the call stack without threading a parameter through every gate.
 *
 * Why: a read_only tenant (admin-console.md §4.2) must still READ — but five
 * GET routes ask for a write permission (contacts, invitations, overrides,
 * distribution, branding), so "which permission" cannot decide 402. The
 * VERB can. The membership gates consult this store; a caller with no
 * request context (a worker, a script) counts as a write and fails closed.
 *
 * Node's own AsyncLocalStorage — no dependency; registered in app.ts as the
 * first onRequest hook in callback style so the store wraps the whole
 * lifecycle (the @fastify/request-context technique).
 */
/** F-71: the live support session this request runs under (set by the impersonation gate). */
export interface ImpersonationContext {
  id: string;
  organizationId: string;
  mode: 'read_only' | 'full';
  platformUserId: string;
  targetUserId: string;
  expiresAt: Date;
}

export interface RequestContext {
  method: string;
  path: string;
  impersonation?: ImpersonationContext;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
