# core-api Cloud Run container image.
# Build TypeScript once, then run the compiled service with production deps only.

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/shared/package.json ./services/shared/package.json
COPY services/core-api/package.json ./services/core-api/package.json

RUN npm ci

FROM deps AS build
COPY tsconfig.json ./tsconfig.json
COPY docs ./docs
COPY services/shared/tsconfig.json ./services/shared/tsconfig.json
COPY services/core-api/tsconfig.json ./services/core-api/tsconfig.json
COPY services/shared/src ./services/shared/src
COPY services/core-api/src ./services/core-api/src

RUN npm run build --workspace=services/shared && npm run build --workspace=services/core-api

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/shared/package.json ./services/shared/package.json
COPY services/core-api/package.json ./services/core-api/package.json

RUN npm ci --omit=dev

COPY --from=build /app/services/shared/dist ./services/shared/dist
COPY --from=build /app/services/core-api/dist ./services/core-api/dist
COPY --from=build /app/docs ./docs

EXPOSE 8080

CMD ["node", "services/core-api/dist/index.js"]
