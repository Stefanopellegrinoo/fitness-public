# Built by CI and pushed to GHCR; the VPS only pulls (same pattern as
# warren-portfolio: the box never builds).
FROM node:24-alpine AS deps
WORKDIR /app
# bcrypt compiles from source when no musl prebuilt matches the platform
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./

FROM deps AS build
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Separate prod install instead of `npm prune`: prune drops the generated
# node_modules/.prisma, which is not a package the lockfile knows about.
FROM deps AS prod-deps
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate && npm cache clean --force

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# the openssl CLI is how Prisma's engine autodetection reads the OpenSSL
# version; without it, it loads the 1.1 engine alpine cannot link
RUN apk add --no-cache openssl \
  && addgroup -S -g 1001 nodejs && adduser -S -u 1001 api -G nodejs
COPY --from=prod-deps --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=api:nodejs /app/dist ./dist
# schema + migrations: `npx prisma migrate deploy` runs from this image
# (the prisma CLI is a runtime dependency for exactly that)
COPY --chown=api:nodejs prisma ./prisma
COPY --chown=api:nodejs package.json ./
USER api
EXPOSE 4002
CMD ["node", "dist/server.js"]
