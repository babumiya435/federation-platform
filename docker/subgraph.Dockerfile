# Builds any TypeScript subgraph: docker build --build-arg PACKAGE=@federation-platform/product .
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG PACKAGE
ENV PACKAGE=${PACKAGE}
CMD ["sh", "-c", "pnpm --filter \"$PACKAGE\" start"]
