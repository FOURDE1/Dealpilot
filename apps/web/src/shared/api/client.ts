import { initClient } from '@ts-rest/core';
import { apiV1 } from '@dealpilot/contracts';

/**
 * The ONLY data plane (ADR-002): typed ts-rest client over the published
 * contract. Cookie auth — no bearer plumbing. Same-origin via the dev proxy.
 */
export const api = initClient(apiV1, {
  baseUrl: '',
  credentials: 'include',
});
