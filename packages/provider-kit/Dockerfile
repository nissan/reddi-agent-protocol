# Build from the repository root:
#   docker build -f packages/provider-kit/Dockerfile -t rap-provider .
# Run with your config and key mounted read-only:
#   docker run -p 8787:8787 -v $PWD/provider.json:/app/provider.json:ro \
#     -v $HOME/.config/solana/provider.json:/keys/provider.json:ro \
#     -v rap-provider-data:/app/.rap-provider \
#     -e RAP_PROVIDER_KEYPAIR_PATH=/keys/provider.json -e UPSTREAM_API_KEY rap-provider
FROM node:24-alpine AS build
WORKDIR /workspace
COPY packages/x402-solana/package*.json packages/x402-solana/
RUN cd packages/x402-solana && npm ci --ignore-scripts
COPY packages/x402-solana/ packages/x402-solana/
RUN cd packages/x402-solana && npm run build
# agent-protocol has no dependencies and ships its built dist/ in the repository.
COPY packages/agent-protocol/package.json packages/agent-protocol/
COPY packages/agent-protocol/dist/ packages/agent-protocol/dist/
COPY packages/provider-kit/package*.json packages/provider-kit/
RUN cd packages/provider-kit && npm ci --ignore-scripts
COPY packages/provider-kit/ packages/provider-kit/
RUN cd packages/provider-kit && npm run build

FROM node:24-alpine
ENV NODE_ENV=production
COPY --from=build /workspace/packages/x402-solana /workspace/packages/x402-solana
COPY --from=build /workspace/packages/agent-protocol /workspace/packages/agent-protocol
COPY --from=build /workspace/packages/provider-kit /workspace/packages/provider-kit
# The provider reads its config from /app and keeps its payment memory in /app/.rap-provider.
WORKDIR /app
RUN mkdir -p /app/.rap-provider && chown -R node:node /app
USER node
EXPOSE 8787
ENTRYPOINT ["node", "/workspace/packages/provider-kit/dist/src/cli.js"]
CMD ["start"]
