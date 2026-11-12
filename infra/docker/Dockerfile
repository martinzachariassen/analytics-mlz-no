# Build context: repository root.
#   docker build -f infra/docker/Dockerfile -t analytics-mlz-no .
#
# Base images are pinned by digest (Dependabot keeps them current). Litestream comes from its
# official image, so its binary is verified by digest too. The DB-IP database is the one thing
# fetched over the network at build time; DBIP_MONTH pins which monthly file, and the build log
# prints its SHA-256.

# Build stages run on the host platform and cross-compile (pure Go, no CGO). Running the Go
# toolchain under amd64 emulation on Apple Silicon crashes, and native builds are much faster.
FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
ARG TARGETOS TARGETARCH
ARG VERSION=dev
WORKDIR /src/apps/server
COPY apps/server/go.mod apps/server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/server ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/analytics ./cmd/analytics

FROM litestream/litestream:0.5.18@sha256:513bff62a88fc0c86c73d27333c41c54c89fe890a7c32a551600adff9309b11b AS litestream

FROM --platform=$BUILDPLATFORM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS assets
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
# DB-IP Lite Country (CC BY 4.0, https://db-ip.com), published monthly as YYYY-MM. Empty = this
# month, falling back to last month early in the month. Set it for a reproducible release build.
ARG DBIP_MONTH=""
RUN apk add --no-cache curl
RUN mkdir -p /geoip && \
    if [ -n "$DBIP_MONTH" ]; then months="$DBIP_MONTH"; \
    else months="$(date +%Y-%m) $(date -d "@$(( $(date +%s) - 2678400 ))" +%Y-%m)"; fi && \
    for m in $months; do \
      curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz" | gunzip > /geoip/dbip-country-lite.mmdb && \
      echo "dbip-country-lite-${m}" > /geoip/VERSION && break; \
    done && \
    test -s /geoip/dbip-country-lite.mmdb && \
    sha256sum /geoip/dbip-country-lite.mmdb && cat /geoip/VERSION

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
ARG VERSION=dev
LABEL org.opencontainers.image.title="analytics-mlz-no" \
      org.opencontainers.image.description="Lightweight, privacy-friendly, self-hostable web analytics" \
      org.opencontainers.image.source="https://github.com/martinzachariassen/analytics-mlz-no" \
      org.opencontainers.image.documentation="https://github.com/martinzachariassen/analytics-mlz-no#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
# Time zones are compiled into the binary (time/tzdata), so only certificates and curl (for
# the health check and the backup upload) are needed.
RUN apk add --no-cache ca-certificates curl && \
    addgroup -g 10001 analytics && \
    adduser -D -H -u 10001 -G analytics analytics && \
    mkdir -p /data && chown analytics:analytics /data
COPY --from=build /out/analytics /usr/local/bin/analytics
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=assets /geoip/dbip-country-lite.mmdb /usr/share/geoip/dbip-country-lite.mmdb
COPY --from=assets /geoip/VERSION /usr/share/geoip/VERSION
COPY infra/docker/litestream.yml /etc/litestream.yml
COPY infra/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/docker/backup.sh /usr/local/bin/backup.sh

ENV DATABASE_PATH=/data/analytics.db \
    GEOIP_DB_PATH=/usr/share/geoip/dbip-country-lite.mmdb \
    PORT=8080

USER 10001:10001
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
