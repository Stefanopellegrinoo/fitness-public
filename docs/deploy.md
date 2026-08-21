# Deploy

## Arquitectura

- **Frontend**: Vercel. El browser solo habla con el dominio de Vercel; Next
  proxya `/backend-api/*` hacia la API (`rewrites` en `next.config.mjs`), así
  que las cookies HttpOnly son first-party y no hay CORS en el browser.
- **Backend**: VPS con Docker. Un stack de Compose propio (`api` + `postgres` +
  `redis`) que convive con los otros proyectos del box, cada uno con su stack y
  sus datos aislados. La API publica `127.0.0.1:4002` — solo el reverse proxy
  del host la alcanza.
- **CI/CD**: cada push a `main` corre la suite completa (backend + frontend,
  en la zona del runner y bajo `TZ=Pacific/Chatham`) y, si pasa, `deploy.yml`
  **construye la imagen en Actions**, la sube a GHCR
  (`ghcr.io/stefanopellegrinoo/fitness-api`) y el VPS solo hace pull, migra y
  reinicia. El box nunca buildea. Hasta que los secrets `VPS_*` no existan, el
  job de deploy se saltea en verde.

## Preparación del VPS (una sola vez)

Requiere Docker con Compose v2 (ya está) y un dominio para la API.

```bash
# Directorio del stack y su .env
sudo mkdir -p /opt/fitness-api
sudo chown "$USER" /opt/fitness-api
cat > /opt/fitness-api/.env <<'EOF'
POSTGRES_USER=fitness
POSTGRES_PASSWORD=<openssl rand -base64 24>
JWT_SECRET=<openssl rand -base64 32>
JWT_REFRESH_SECRET=<openssl rand -base64 32, distinto>
CORS_ORIGIN=https://<tu-app>.vercel.app
EOF
chmod 600 /opt/fitness-api/.env

# Login de Docker a GHCR (la imagen es privada): un PAT classic con read:packages
docker login ghcr.io -u Stefanopellegrinoo

# Clave SSH exclusiva para deploys (la privada va al secret VPS_SSH_KEY)
ssh-keygen -t ed25519 -f ~/.ssh/gha_fitness -N ''
cat ~/.ssh/gha_fitness.pub >> ~/.ssh/authorized_keys
```

El primer deploy (o un `workflow_dispatch`) copia `deploy/docker-compose.yml`
a `/opt/fitness-api/` y levanta todo; los datos quedan en el volumen
`fitness_pg_data`.

Reverse proxy del host (Caddy, mínimo):

```
api.tudominio.com {
    reverse_proxy 127.0.0.1:4002
}
```

Si el ingreso es por Cloudflare Tunnel en vez de Caddy, apuntar el hostname
del túnel a `http://localhost:4002`.

**Firewall (OCI)**: abrir 80/443 en la Security List **y** en el host. Ojo:
los puertos que Docker publica en `0.0.0.0` se saltean el firewall del host —
por eso el compose de fitness publica la API solo en `127.0.0.1` y no publica
Postgres ni Redis en absoluto.

## Secrets en GitHub (Settings → Secrets and variables → Actions)

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o dominio del VPS |
| `VPS_USER` | el usuario dueño de `/opt/fitness-api` |
| `VPS_SSH_KEY` | contenido de `~/.ssh/gha_fitness` (la privada) |

## Vercel

- Root directory: `frontend/`.
- Variable de entorno `BACKEND_ORIGIN=https://api.tudominio.com` (sin barra
  final). Sin ella, el proxy apunta al backend local de desarrollo.

## Qué hace cada deploy

1. Suite completa como gate (reusa `ci.yml`).
2. Buildea la imagen (`backend/app/Dockerfile`) en Actions y la pushea a GHCR
   con dos tags: `latest` y el SHA del commit.
3. Copia `deploy/docker-compose.yml` al VPS.
4. En el VPS, **pineado al SHA que la suite acaba de aprobar**:
   `docker compose pull` → `docker compose run --rm api npx prisma migrate
   deploy` → `docker compose up -d` → chequeo de `/health`.

## Rollback

Cada commit deja su imagen taggeada por SHA en GHCR. Para volver atrás:
re-correr el deploy desde el commit anterior (workflow_dispatch sobre ese SHA
o revert + push), o a mano en el VPS:

```bash
cd /opt/fitness-api
FITNESS_IMAGE=ghcr.io/stefanopellegrinoo/fitness-api:<sha-anterior> docker compose up -d api
```

Las migraciones de Prisma no se revierten solas — si una migración es el
problema, escribir la migración inversa y deployar.
