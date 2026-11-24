import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The worker serves dist/ and answers /api/* itself; in dev, Vite proxies the API to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // rules.js sits at the repository's root, shared with the extension and the server.
  server: { proxy: { '/api': 'https://matstats.mohamed3on.com', '/tiles': 'https://matstats.mohamed3on.com' }, fs: { allow: ['..'] } },
});
