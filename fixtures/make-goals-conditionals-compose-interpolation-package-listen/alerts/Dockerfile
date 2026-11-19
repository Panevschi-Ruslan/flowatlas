FROM debian:12-slim
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/node
WORKDIR /app
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
