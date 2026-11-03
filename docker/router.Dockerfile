FROM rust:1.99.1-bookworm AS build
# hive-router's build script runs `npm install` to bundle the GraphiQL UI.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build/router
# Build the dependencies first, against an empty program, so editing the plugin does not
# recompile the whole router. This layer only changes when Cargo.toml/Cargo.lock do.
COPY router/Cargo.toml router/Cargo.lock router/rust-toolchain.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src
COPY router/src ./src
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/router/target/release/federation-router /usr/local/bin/federation-router
COPY router/router.config.yaml /app/router.config.yaml
EXPOSE 4000
ENTRYPOINT ["federation-router"]
