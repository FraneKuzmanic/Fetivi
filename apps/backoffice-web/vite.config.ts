import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The API is proxied so the SPA and its session cookie share one origin, as on `host.` in production.
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
