# Image de l'application : l'API compilée sert aussi le frontend construit.
# Trois étapes : construire le frontend, construire l'API, puis une image d'exécution
# qui ne contient que le code compilé et les dépendances de production
# (ni TypeScript, ni ts-node, ni tsx).

# --- 1. Frontend -------------------------------------------------------------
FROM node:24-slim AS build-web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- 2. API ------------------------------------------------------------------
FROM node:24-slim AS build-api
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build

# --- 3. Exécution ------------------------------------------------------------
FROM node:24-slim AS execution
ENV NODE_ENV=production
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build-api /app/api/dist ./dist
# Les fichiers SQL lus par le script de migration (dist/commands/migrer.js -> migrations/).
COPY api/migrations ./migrations
# Même chemin relatif qu'en local : api/dist/main.js -> web/dist.
COPY --from=build-web /app/web/dist /app/web/dist
USER node
EXPOSE 3000
# Au démarrage : migrations, comptes de démonstration (seulement si DEMO_MODE=true ;
# idempotent), puis l'API compilée.
CMD ["sh", "-c", "node dist/commands/migrer.js && node dist/commands/seed.js && node dist/main.js"]
