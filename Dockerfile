# syntax=docker/dockerfile:1.7
#
# 本镜像使用「预构建前端」：先 `make web`（或 CI 的 web job 下载 web-dist），
# 再 `docker build`。这样：
#   - 前端只构建一次，二进制与镜像共用同一份 web/dist；
#   - arm64 镜像不再在 QEMU 里跑 Node / Go，Go 在构建机上直接交叉编译。
#
# 基础镜像按 digest 固定，升级时用：
#   docker buildx imagetools inspect golang:1.27-alpine
#   docker buildx imagetools inspect gcr.io/distroless/static-debian12:nonroot

# ---------- 1. 编译 Go 后端（内嵌预构建前端） ----------
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS srv
WORKDIR /src
COPY server/ ./
RUN rm -rf ./internal/webdist
COPY web/dist/ ./internal/webdist/
# 仓库根 data/ 是唯一来源；web/dist 里已有一份，这里再覆盖一次，保证与
# scripts/build-binary.sh 生成的单文件二进制完全同源。
COPY data/ ./internal/webdist/data/
# 版本号注入（-X main.version）；可 docker build --build-arg VERSION=1.2.3 覆盖。
ARG VERSION=dev
# BuildKit 自动注入的目标平台参数（必须在本 stage 内重新声明才能用于 RUN）。
ARG TARGETOS
ARG TARGETARCH
# CGO_ENABLED=0 时可直接交叉编译；-trimpath / -buildvcs=false / -buildid= 用于可复现构建。
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false \
      -ldflags="-s -w -buildid= -X main.version=${VERSION}" -o /out/tswui .

# ---------- 2. 运行时（保持目标平台，不能固定 BUILDPLATFORM） ----------
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=srv /out/tswui /tswui
EXPOSE 8080
ENV LISTEN=:8080 \
    TSHOCK_URL=http://tshock:7878 \
    TSHOCK_METHOD=POST
USER nonroot:nonroot
ENTRYPOINT ["/tswui"]
