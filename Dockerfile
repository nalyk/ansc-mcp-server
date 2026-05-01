### Stage 1 — build TypeScript ##################################################
FROM node:24-alpine AS build
WORKDIR /app

# Use a deterministic, audited install.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies for the runtime image.
RUN npm prune --omit=dev

### Stage 2 — runtime ###########################################################
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    MCP_TRANSPORT=stdio

# Run as a non-root user.
RUN addgroup -S mcp && adduser -S mcp -G mcp

COPY --from=build --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=build --chown=mcp:mcp /app/build ./build
COPY --chown=mcp:mcp package.json ./

USER mcp

# stdio mode is the default; switch to HTTP by setting MCP_TRANSPORT=http.
EXPOSE 3030
ENTRYPOINT ["node", "build/index.js"]
