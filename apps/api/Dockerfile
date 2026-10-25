FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.20.0
COPY . .
ENV HUSKY=0
RUN pnpm --filter @atlas/api install --frozen-lockfile
RUN pnpm --filter @atlas/api build
RUN pnpm --filter @atlas/api deploy --prod --legacy /runtime

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /runtime /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
