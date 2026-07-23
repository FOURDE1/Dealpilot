import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { createPool } from '@dealpilot/db';
import type { ErrorEnvelopeT } from '@dealpilot/schemas';
import { createAuth, type Auth } from './auth.js';
import { loadEnv, type Env } from './env.js';

/**
 * Dealpilot API (A-05): Fastify 5 skeleton.
 * - pino structured logs with per-request ids (api-security.md: no PII in logs)
 * - canonical error envelope on EVERY non-2xx (api-design.md §8)
 * - deny-by-default auth gate: everything requires a session except the
 *   explicit public allowlist (authentication-authorization.md §Deny-by-default)
 * - Better Auth mounted at /api/auth/* (identity + sessions)
 * Entity CRUD endpoints arrive with their feature slices (D-018), never here.
 */

/**
 * Public routes are matched against the ROUTED pattern (`request.routeOptions.url`),
 * not the raw request target — the router has already normalized/decoded the
 * path by the time onRequest runs, so `/api/auth/../v1/me` can never sneak past
 * the gate. An unmatched route has no routeOptions.url → denied by default.
 */
const PUBLIC_ROUTES: readonly string[] = ['/api/v1/health', '/api/auth/*'];

/** Fastify-internal error codes → canonical, stable API codes (api-design.md §8). */
const FASTIFY_CODE_MAP: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'validation_failed',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'validation_failed',
  FST_ERR_VALIDATION: 'validation_failed',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
};

function envelope(code: string, message: string, requestId: string, details?: { path?: string; code: string; message: string }[]): ErrorEnvelopeT {
  return { error: { code, message, ...(details ? { details } : {}), request_id: requestId } };
}

async function toWebRequest(request: FastifyRequest): Promise<Request> {
  const url = `${request.protocol}://${request.host}${request.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.append(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  const method = request.method;
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : request.body !== undefined && request.body !== null
        ? JSON.stringify(request.body)
        : undefined;
  return new Request(url, { method, headers, body });
}

export async function buildApp(envOverrides: Partial<Record<keyof Env, string>> = {}) {
  const env = loadEnv(envOverrides);
  const pool = createPool({ connectionString: env.DATABASE_URL });
  const auth: Auth = createAuth(env, pool);

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => randomUUID(),
    disableRequestLogging: env.NODE_ENV === 'test',
  });

  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
  });

  // --- canonical error envelope everywhere -------------------------------
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const requestId = String(request.id);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
      // Generic message to clients; details stay in logs (CLAUDE.md security).
      return reply.status(500).send(envelope('internal_error', 'Internal server error', requestId));
    }
    const code = (err.code && FASTIFY_CODE_MAP[err.code]) ?? (err.code ? 'bad_request' : 'bad_request');
    const details =
      err.validation?.map((v) => ({
        path: v.instancePath || v.schemaPath,
        code: v.keyword,
        message: v.message ?? 'invalid',
      })) ?? undefined;
    return reply.status(status).send(envelope(code, err.message, requestId, details));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(envelope('not_found', 'Route not found', String(request.id)));
  });

  // --- deny-by-default session gate --------------------------------------
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const routedPath = request.routeOptions.url ?? '';
    if (PUBLIC_ROUTES.includes(routedPath)) return;
    const webReq = await toWebRequest(request);
    const session = await auth.api.getSession({ headers: webReq.headers });
    if (!session) {
      return reply
        .status(401)
        .send(envelope('unauthenticated', 'Authentication required', String(request.id)));
    }
    request.session = session;
  });

  // --- Better Auth mount ---------------------------------------------------
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(await toWebRequest(request));
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
        else void reply.header(key, value);
      });
      reply.send(response.body ? await response.text() : null);
    },
  });

  // --- routes --------------------------------------------------------------
  app.get('/api/v1/health', async () => {
    let db = 'down';
    try {
      await pool.query('SELECT 1');
      db = 'up';
    } catch {
      /* reported as down */
    }
    return { status: 'ok', db };
  });

  /** Proves the session gate end-to-end; the web shell's session probe (H-03). */
  app.get('/api/v1/me', async (request) => {
    // Safe: the deny-by-default gate guarantees a session on every non-public route.
    const { user, session } = request.session!;
    return {
      user: { id: user.id, email: user.email, name: user.name },
      session: { expires_at: session.expiresAt },
    };
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return { app, env, pool, auth };
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: Awaited<ReturnType<Auth['api']['getSession']>>;
  }
}
