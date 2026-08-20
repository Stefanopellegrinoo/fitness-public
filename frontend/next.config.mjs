import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this app so Next never infers it from stray
  // lockfiles/package.json higher up the tree (e.g. ~/package.json). Without
  // this, multiple lockfiles make Next resolve modules like `tailwindcss` from
  // the wrong directory -> "Can't resolve 'tailwindcss'".
  // Local-only: on Vercel (monorepo Root Directory) the pin makes @vercel/next
  // re-root .next against the repo clone and the deploy dies at "Deploying
  // outputs..." with ENOENT on .next/routes-manifest-deterministic.json.
  ...(process.env.VERCEL
    ? {}
    : { outputFileTracingRoot: __dirname, turbopack: { root: __dirname } }),
  // Hosts allowed to load dev-server resources (HMR, /_next/*) from an origin
  // other than localhost. Needed to open the dev server through an HTTPS tunnel,
  // which the barcode scanner requires: getUserMedia only works on a secure origin.
  allowedDevOrigins: ['dev.fratellipastas.com'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/backend-api/:path*',
        // BACKEND_ORIGIN points at the deployed API (e.g. https://api.example.com);
        // unset, it targets the local dev backend over IPv4.
        destination: `${process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:4002'}/api/:path*`
      }
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self)' },
        ],
      },
    ]
  },
}

export default nextConfig
