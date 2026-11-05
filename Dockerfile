FROM node:24.22.2-bookworm-slim
WORKDIR /workspace
RUN npm install --global pnpm@10.34.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared packages/shared
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter @pos/backend...
COPY apps/backend apps/backend
RUN pnpm --filter @pos/backend build
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@pos/backend", "start"]
