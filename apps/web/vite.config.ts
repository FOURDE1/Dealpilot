import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin /api in dev: cookies stay first-party (SameSite=Lax) and no
    // CORS is involved; the API's WEB_ORIGIN default matches this origin.
    proxy: {
      '/api': 'http://localhost:3001',
      // The realtime upgrade needs `ws: true` — without it Vite proxies the
      // handshake and then drops the protocol switch, which looks exactly like
      // a server that never sends events.
      '/realtime': { target: 'http://localhost:3001', ws: true },
    },
  },
});
