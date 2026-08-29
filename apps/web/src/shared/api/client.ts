import { apiV1 } from '@dealpilot/contracts';
import { ErrorEnvelope } from '@dealpilot/schemas';

/**
 * The ONLY data plane (ADR-002): every request is driven by the published
 * contract object (method + path from `apiV1` — never hand-written routes)
 * and every response is PARSED by the @dealpilot/schemas zod schemas at the
 * call site (parse-don't-validate).
 *
 * Why not ts-rest's initClient: @ts-rest/core 3.52 (latest) predates zod 4 in
 * type space — client inference collapses and every method types as
 * non-callable. The contract VALUES are unaffected. Revisit when ts-rest
 * ships zod-4 client support (noted for AHMAD in the session log).
 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * Thrown for any non-2xx contract response. `fieldPath` carries the server's
 * envelope detail path (409 conflicts AND 422 validation) so forms can
 * localize per-field.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly fieldPath?: string,
    readonly code?: string,
    /** The envelope's top-level error code (e.g. 'checklist_incomplete'). */
    readonly errorCode?: string,
    /** Every detail code — one per offending item when the server lists them. */
    readonly detailCodes?: string[],
    /**
     * Every detail message. For list-shaped refusals (F-13's
     * `documents_outstanding`, dispatch's `wet_ink_not_ready`) each message is
     * the NAME of an offending item, and showing them is the whole point.
     */
    readonly detailMessages?: string[],
    /**
     * Every detail path, in the envelope's order (aligned with `detailCodes`
     * when the server sets both). A multi-field 422 (F-70's provisioning form)
     * marks every refused input at once instead of one per round-trip.
     */
    readonly detailPaths?: string[],
  ) {
    super(`API ${status}`);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function apiRequest(
  // ts-rest's route type hides `path` behind an index signature — accept the
  // narrow structural type it does expose and guard the path at runtime.
  route: { method: string },
  opts?: {
    params?: Record<string, string>;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    /** react-query's cancellation signal — combined with the timeout. */
    signal?: AbortSignal;
  },
): Promise<ApiResponse> {
  const rawPath: unknown = (route as Record<string, unknown>)['path'];
  if (typeof rawPath !== 'string') {
    throw new Error('Contract route has no path');
  }
  let path = rawPath;
  for (const [key, value] of Object.entries(opts?.params ?? {})) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  if (path.includes('/:')) {
    throw new Error(`Unsubstituted path param in ${path}`);
  }
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(opts?.query ?? {})) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const hasBody = opts?.body !== undefined;
  // Every external call gets an explicit timeout (CLAUDE.md).
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(qs.size > 0 ? `${path}?${qs.toString()}` : path, {
    method: route.method,
    credentials: 'include',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
  });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  return { status: res.status, body };
}

/**
 * Throws ApiError for a non-2xx contract response, extracting the envelope's
 * first detail path (409 conflicts, 422 validation) for per-field messages.
 */
export function failFromResponse(status: number, body: unknown): never {
  const parsed = ErrorEnvelope.safeParse(body);
  const details = parsed.success ? (parsed.data.error.details ?? []) : [];
  const errorCode = parsed.success ? parsed.data.error.code : undefined;
  // F-71: the shell reacts to impersonation answers globally — the banner
  // speaks the refusal and an ended session clears itself — without every
  // form learning the vocabulary. Guarded: tests import this file in Node.
  if (
    typeof window !== 'undefined' &&
    (errorCode === 'impersonation_ended' || errorCode === 'impersonation_read_only' || errorCode === 'impersonation_forbidden')
  ) {
    window.dispatchEvent(new CustomEvent('dealpilot:impersonation', { detail: { code: errorCode } }));
  }
  throw new ApiError(
    status,
    details[0]?.path,
    details[0]?.code,
    errorCode,
    details.map((d) => d.code).filter((c): c is string => typeof c === 'string'),
    details.map((d) => d.message).filter((m): m is string => typeof m === 'string'),
    details.map((d) => d.path ?? ''),
  );
}

/** Contract routes (method/path values) — the source of truth for every call. */
export const routes = apiV1;
