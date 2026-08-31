import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * F-74: the e2e runner (scripts/e2e.mjs) moves the API off :3001 so the dev
 * stack can stay up while the suite runs. This proxy target is the ONLY place
 * the API port lives on the SPA side — `grep -rnE '3001|localhost' apps/web/src`
 * is empty (re-verified), so moving the port is exactly this one read and no
 * other. Default unchanged: `pnpm dev` is untouched.
 */
if (process.env.DEALPILOT_E2E === '1' && !process.env.DEALPILOT_API_PORT) {
  // Under the e2e runner a LOST port is worse than a wrong one: the proxy
  // would fall back to the dev API on :3001, and the suite would pass green
  // against the dev database. Refuse instead.
  throw new Error('DEALPILOT_E2E=1 but DEALPILOT_API_PORT is unset — run the suite with `pnpm e2e` (scripts/e2e.mjs).');
}
const API = `http://localhost:${process.env.DEALPILOT_API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin /api in dev: cookies stay first-party (SameSite=Lax) and no
    // CORS is involved; the API's WEB_ORIGIN default matches this origin.
    proxy: {
      '/api': API,
      // The realtime upgrade needs `ws: true` — without it Vite proxies the
      // handshake and then drops the protocol switch, which looks exactly like
      // a server that never sends events.
      '/realtime': { target: API, ws: true },
    },
  },
});
