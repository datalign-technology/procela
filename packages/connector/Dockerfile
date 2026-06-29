## Procela on-prem connector image.
##
## Multistage build: stage 1 installs full deps and compiles
## TypeScript -> dist/. Stage 2 runs the compiled output on a slim
## node image with only production deps, so the final image stays
## small and ships no toolchain.

# ---- builder ----------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /build

COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:20-slim AS runtime

# Run as a non-root user. Connector only needs outbound HTTP +
# read access to its YAML config — no reason to grant root.
RUN useradd --create-home --shell /bin/false --uid 10001 procela

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=builder /build/dist ./dist

# Default config path — operator mounts their connector.yaml here.
# Override with PROCELA_CONNECTOR_CONFIG if you prefer a different path.
RUN mkdir -p /etc/procela && chown -R procela:procela /etc/procela /app

USER procela

ENTRYPOINT ["node", "dist/index.js"]
