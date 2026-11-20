FROM node:24-alpine AS build
WORKDIR /workspace

COPY packages/x402-solana/package*.json packages/x402-solana/
WORKDIR /workspace/packages/x402-solana
RUN npm ci --ignore-scripts
COPY packages/x402-solana/ ./
RUN npm run build

# The receipt signer comes from @reddi/agent-protocol, which has no dependencies
# and ships its built dist/ in the repository.
WORKDIR /workspace
COPY packages/agent-protocol/package.json packages/agent-protocol/
COPY packages/agent-protocol/dist/ packages/agent-protocol/dist/
COPY packages/openrouter-specialists/package*.json packages/openrouter-specialists/
WORKDIR /workspace/packages/openrouter-specialists
RUN npm ci --ignore-scripts
COPY packages/openrouter-specialists/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /workspace/packages/openrouter-specialists
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
COPY --from=build /workspace/packages/x402-solana /workspace/packages/x402-solana
COPY --from=build /workspace/packages/agent-protocol /workspace/packages/agent-protocol
COPY --from=build /workspace/packages/openrouter-specialists /workspace/packages/openrouter-specialists
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
