# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# prisma is a runtime dependency (not just dev) so the CLI + its
# migration engine ship in the production image — the container can run
# `prisma migrate deploy` at deploy time (e.g. the Helm migrate hook Job).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

# The app writes to /app/.procela-data at runtime (JSON-store fallback and the
# startup data-migration flag files). /app is root-owned from the COPYs above,
# so create that dir and hand it to the non-root runtime user — otherwise the
# first write fails with EACCES (e.g. mkdir '/app/.procela-data/migrations').
RUN mkdir -p /app/.procela-data && chown -R appuser:appgroup /app/.procela-data

USER appuser

EXPOSE 3001

CMD ["node", "dist/index.js"]
