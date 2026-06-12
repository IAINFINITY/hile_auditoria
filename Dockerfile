# Dockerfile — auditoria_hile (Next.js 16 + Prisma/Supabase)
# Build e runtime usam a MESMA base (bookworm-slim) para o query engine
# do Prisma (gerado via postinstall) casar com o ambiente de execução.

FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma precisa de openssl + ca-certificates em runtime
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- deps + build ----------
FROM base AS builder
# Variáveis NEXT_PUBLIC_* são "inlined" no bundle do client em build-time,
# por isso precisam estar presentes AQUI (não bastam em runtime).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES=30
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES=$NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES

COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci roda o postinstall (prisma generate) com o engine nativo da base
RUN npm ci
COPY . .
RUN npm run build

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3001
# Roda como usuário não-root (o node:20 já traz o usuário "node")
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 3001
CMD ["npm", "run", "start"]
