import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this app so Next never infers it from stray
  // lockfiles/package.json higher up the tree (e.g. ~/package.json). Without
  // this, multiple lockfiles make Next resolve modules like `tailwindcss` from
  // the wrong directory -> "Can't resolve 'tailwindcss'".
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
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
        destination: 'http://127.0.0.1:4002/api/:path*' // proxy to Backend using IPv4
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
