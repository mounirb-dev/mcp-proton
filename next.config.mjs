import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['playwright-core', 'pg'],
  // no se usa next/image: sin sharp se ahorran ~37 MB de imagen y su RAM
  images: { unoptimized: true },
  outputFileTracingExcludes: { '*': ['./node_modules/@img/**/*', './node_modules/sharp/**/*'] },
  turbopack: { root },
  outputFileTracingRoot: root,
  // playwright-core lee browsers.json y otros archivos dinámicamente: el trazado
  // estático no los ve, así que se incluye el paquete completo en las rutas que lo usan.
  outputFileTracingIncludes: {
    '/mcp': ['./node_modules/playwright-core/**/*'],
    '/api/admin/**': ['./node_modules/playwright-core/**/*'],
  },
};

export default nextConfig;
