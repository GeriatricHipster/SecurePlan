import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  if (mode === 'native') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const nativeApiUrl = process.env.VITE_API_URL || env.VITE_API_URL;

    if (!nativeApiUrl) {
      throw new Error(
        'Native build requires VITE_API_URL. Set it to the public HTTPS SecurePlan server URL in .env.native or the build environment.',
      );
    }

    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(nativeApiUrl);
    } catch {
      throw new Error('VITE_API_URL must be an absolute http:// or https:// URL.');
    }

    if (!['http:', 'https:'].includes(parsedApiUrl.protocol)) {
      throw new Error('VITE_API_URL must be an absolute http:// or https:// URL.');
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3000',
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});
