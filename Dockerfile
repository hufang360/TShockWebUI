# ---------- 1. 构建前端 ----------
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
# BuildKit 缓存挂载：只在依赖变化时才真正重新下载 npm 包。
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# 仓库根 data/ 挂到容器 /data（Vite 的 dataDirPlugin 默认读 web/../data）；
# 构建时复制到 dist/data，随前端产物一起被 Go 后端内嵌。
COPY data/ /data/
RUN npm run build

# ---------- 2. 构建 Go 后端（内嵌前端产物） ----------
FROM golang:1.27-alpine AS srv
WORKDIR /src
COPY server/ ./
RUN rm -rf ./internal/webdist
COPY --from=web /web/dist/ ./internal/webdist/
# 版本号注入（-X main.version）；可 docker build --build-arg VERSION=1.2.3 覆盖。
ARG VERSION=dev
# 缓存 Go 构建与模块缓存，仅代码变化时重编。
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/tswui .

# ---------- 3. 运行时 ----------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=srv /out/tswui /tswui
EXPOSE 8080
ENV LISTEN=:8080 \
    TSHOCK_URL=http://tshock:7878 \
    TSHOCK_METHOD=POST
USER nonroot:nonroot
ENTRYPOINT ["/tswui"]
