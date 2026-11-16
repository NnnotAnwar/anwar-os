# syntax=docker/dockerfile:1
# ops-agent image: one static binary on `scratch` (~7 MB). Multi-arch without
# emulation: the build stage runs on the builder's platform and cross-compiles.
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/<owner>/anwar-os-ops-agent:<sha> --build-arg VERSION=<sha> services/ops-agent

FROM --platform=$BUILDPLATFORM golang:1.26.1-alpine AS build
ARG TARGETOS TARGETARCH VERSION=dev
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/ops-agent .

FROM scratch
ARG VERSION=dev
LABEL org.opencontainers.image.title="anwar.os ops-agent" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=build /out/ops-agent /ops-agent
# Non-root. Access to /var/run/docker.sock comes from the socket's group, added
# at run time (compose: group_add: ["${DOCKER_GID}"]).
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/ops-agent", "-healthcheck"]
ENTRYPOINT ["/ops-agent"]
