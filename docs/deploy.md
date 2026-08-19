# Deploy

## Arquitectura

- **Frontend**: Vercel. El browser solo habla con el dominio de Vercel; Next
  proxya `/backend-api/*` hacia la API (`rewrites` en `next.config.mjs`), así
  que las cookies HttpOnly son first-party y no hay CORS en el browser.
- **Backend**: VPS (Oracle) con Node 24, PostgreSQL 16 y Redis, detrás de un
  reverse proxy con TLS (Caddy). La API escucha en `127.0.0.1:4002`.
- **CI/CD**: cada push a `main` corre la suite completa (backend + frontend,
  en la zona local del runner y bajo `TZ=Pacific/Chatham`) y, si pasa,
  `deploy.yml` compila en Actions, sube los artefactos por rsync y reinicia el
  servicio. Hasta que los secrets `VPS_*` no existan, el job de deploy se
  saltea en verde — se puede mergear el pipeline antes de tener el server.

## Preparación del VPS (una sola vez)

Requiere un dominio apuntando al VPS (Vercel tiene que llegar por HTTPS).

```bash
# Usuario de deploy y directorio de la app
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/fitness-api/app
sudo chown -R deploy:deploy /opt/fitness-api

# Node 24, PostgreSQL 16, Redis, Caddy (según la distro del VPS)
# Postgres: crear base `fitness` y un usuario propio con password fuerte.

# Variables de entorno del servicio (usar backend/app/.env.example como guía)
sudo -u deploy nano /opt/fitness-api/app/.env
#   NODE_ENV=production
#   PORT=4002
#   DATABASE_URL=postgresql://...
#   JWT_SECRET / JWT_REFRESH_SECRET  (openssl rand -base64 32, distintos)
#   REDIS_URL=redis://localhost:6379
#   CORS_ORIGIN=https://<tu-app>.vercel.app

# Servicio systemd
sudo cp deploy/fitness-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable fitness-api

# El pipeline reinicia el servicio sin password:
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart fitness-api' | sudo tee /etc/sudoers.d/fitness-deploy

# Clave SSH exclusiva para deploys (la privada va al secret VPS_SSH_KEY)
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/gha_deploy -N ''
sudo -u deploy sh -c 'cat /home/deploy/.ssh/gha_deploy.pub >> /home/deploy/.ssh/authorized_keys'
```

Caddy, mínimo (`/etc/caddy/Caddyfile`):

```
api.tudominio.com {
    reverse_proxy 127.0.0.1:4002
}
```

## Secrets en GitHub (Settings → Secrets and variables → Actions)

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o dominio del VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contenido de `/home/deploy/.ssh/gha_deploy` (la privada) |

## Vercel

- Root directory: `frontend/`.
- Variable de entorno `BACKEND_ORIGIN=https://api.tudominio.com` (sin barra
  final). Sin ella, el proxy apunta al backend local de desarrollo.

## Qué hace cada deploy

1. Suite completa como gate (reusa `ci.yml`).
2. `npm ci` + `prisma generate` + `tsc` en el runner.
3. `rsync` de `dist/`, `prisma/`, `package.json` y `package-lock.json` a
   `/opt/fitness-api/app/` — el `.env` y `node_modules` del server no se tocan.
4. En el server: `npm ci --omit=dev`, `prisma migrate deploy`,
   `systemctl restart fitness-api` y chequeo de `/health`.

## Rollback

Los artefactos no se versionan en el server: para volver atrás, re-correr el
deploy desde el commit anterior (workflow_dispatch sobre ese SHA o revert +
push). Las migraciones de Prisma no se revierten solas — si una migración es
el problema, escribir la migración inversa y deployar.
