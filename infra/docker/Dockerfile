# Build context: repository root.
#   docker build -f infra/docker/Dockerfile -t analytics-mlz-no .

# Build stages run on the host platform and cross-compile (pure Go, no CGO). Running the Go
# toolchain under amd64 emulation on Apple Silicon crashes, and native builds are much faster.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
ARG VERSION=dev
WORKDIR /src/apps/server
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/analytics ./cmd/analytics

FROM --platform=$BUILDPLATFORM alpine:3.24 AS assets
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
ARG TARGETARCH
ARG LITESTREAM_VERSION=0.5.17
RUN apk add --no-cache curl
# Litestream binary.
RUN case "${TARGETARCH:-amd64}" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz" \
      | tar -xz -C /usr/local/bin litestream
# DB-IP Lite Country (CC BY 4.0, https://db-ip.com). Published monthly; fall back to last month early in the month.
RUN mkdir -p /geoip && \
    for m in "$(date +%Y-%m)" "$(date -d "@$(( $(date +%s) - 2678400 ))" +%Y-%m)"; do \
      curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz" | gunzip > /geoip/dbip-country-lite.mmdb && break; \
    done && \
    test -s /geoip/dbip-country-lite.mmdb

FROM alpine:3.24
ARG VERSION=dev
LABEL org.opencontainers.image.title="analytics-mlz-no" \
      org.opencontainers.image.description="Lightweight, privacy-friendly, self-hostable web analytics" \
      org.opencontainers.image.source="https://github.com/martinzachariassen/analytics-mlz-no" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
RUN apk add --no-cache ca-certificates tzdata curl && \
    adduser -D -H -u 10001 analytics && \
    mkdir -p /data && chown analytics /data
COPY --from=build /out/analytics /usr/local/bin/analytics
COPY --from=assets /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=assets /geoip/dbip-country-lite.mmdb /usr/share/geoip/dbip-country-lite.mmdb
COPY infra/docker/litestream.yml /etc/litestream.yml
COPY infra/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/docker/backup.sh /usr/local/bin/backup.sh

ENV DATABASE_PATH=/data/analytics.db \
    GEOIP_DB_PATH=/usr/share/geoip/dbip-country-lite.mmdb \
    PORT=8080

USER analytics
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
