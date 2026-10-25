import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const webDir = fileURLToPath(new URL('.', import.meta.url))
// 仓库根 data/（生成数据）。不再用 web/public/data 符号链接，避免 Windows / CI 失效。
const dataDir = join(webDir, '..', 'data')

/** 前端版本号：取自 web/package.json，构建时注入 `__APP_VERSION__`。 */
const pkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as { version: string }

/**
 * 把仓库根 `data/` 挂到 `/data/*`：
 * - 开发：中间件直接读 `data/`（改数据刷新即可）；
 * - 构建：复制到 `dist/data/`，随前端产物一起被 Go 后端内嵌。
 */
function dataDirPlugin(): Plugin {
  const contentTypes: Record<string, string> = {
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
  }
  return {
    name: 'tswui-data-dir',
    configureServer(server) {
      const urlPrefix = '/data/'
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith(urlPrefix)) return next()
        const file = join(dataDir, decodeURIComponent(url.slice(urlPrefix.length)))
        if (file !== dataDir && !file.startsWith(dataDir + sep)) return next()
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const outDir = join(webDir, 'dist', 'data')
      mkdirSync(outDir, { recursive: true })
      for (const name of readdirSync(dataDir)) {
        const src = join(dataDir, name)
        if (statSync(src).isFile()) copyFileSync(src, join(outDir, name))
      }
    },
  }
}

// 单容器交付（设计原则与约束 §4.1）：默认固定在根路径 `/`，静态资源与 `/api/*` 同源。
// GitHub Pages 演示构建通过 VITE_BASE 改成仓库子路径（如 `/TShockWebUI/`）。
const base = (process.env.VITE_BASE || '/').replace(/\/*$/, '/')

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), dataDirPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 开发期把 /api/* 代理到本机 Go 后端（server/，默认 :8080）。
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
