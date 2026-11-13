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
    '.gif': 'image/gif',
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
      // 递归复制：`data/langpacks/` 里的内置语言材质包也要一起进产物。
      const copyTree = (srcDir: string, destDir: string) => {
        mkdirSync(destDir, { recursive: true })
        for (const name of readdirSync(srcDir)) {
          const src = join(srcDir, name)
          const dest = join(destDir, name)
          if (statSync(src).isDirectory()) copyTree(src, dest)
          else if (statSync(src).isFile()) copyFileSync(src, dest)
        }
      }
      copyTree(dataDir, outDir)
    },
  }
}

// 单容器交付（设计原则与约束 §4.1）：默认固定在根路径 `/`，静态资源与 `/api/*` 同源。
// GitHub Pages 演示构建通过 VITE_BASE 改成仓库子路径（如 `/TShockWebUI/`）。
const base = (process.env.VITE_BASE || '/').replace(/\/*$/, '/')

/**
 * 首屏体积的两处约束（改前：单块 516 kB，且首屏混入只被懒加载页面用到的 UI 组件）：
 * 1. `treeshake.moduleSideEffects`：默认的保守 tree-shaking 会认为每个模块都可能有副作用，
 *    于是 `@/components/ui` 桶文件（App.tsx 引入）里没人用到的 Drawer / Slider / Accordion /
 *    Switch / Pagination 也都进了首屏。声明「只有 CSS 有副作用」后它们会被摇掉。
 * 2. `codeSplitting`：第三方库按来源拆成独立 chunk，避免单块超过 500 kB 的告警，
 *    也让改业务代码时不必重新下载 react / radix。
 *    `tags: ['$initial']` 是关键：不加它，分组会把懒加载页面才依赖的模块也捕获回首屏。
 */
export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), dataDirPlugin()],
  build: {
    rolldownOptions: {
      treeshake: { moduleSideEffects: ['**/*.css'] },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              tags: ['$initial'],
            },
            {
              name: 'vendor-ui',
              test: /node_modules[\\/](@radix-ui|@base-ui|@floating-ui|sonner|react-resizable-panels|tailwind-merge|class-variance-authority|clsx|lucide-react)[\\/]/,
              tags: ['$initial'],
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 开发期端口：默认 5173（make dev-web 会传 VITE_PORT）；后端在 18080，
    // 端口分工见 Makefile 的 WEB_PORT / API_PORT。
    port: Number(process.env.VITE_PORT) || 5173,
    // 端口被占时直接报错，而不是静默换到下一个（否则你会对着旧页面调半天）。
    strictPort: true,
    // 开发期把 /api/* 代理到本机 Go 后端（server/，默认 :8080）。
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
  test: {
    // 默认 jsdom：组件 / 页面测试要真实 DOM。纯逻辑测试（本地存储、解析、换算……）
    // 在文件头写 `// @vitest-environment node` 即可——jsdom 每个文件要现建一次文档
    // （约 0.4s），纯逻辑用例占全部文件的一半，白白多花十几秒 CPU。
    environment: 'jsdom',
    // 默认的 forks 每个文件都要 fork 一个进程；threads 复用 worker 线程，
    // 全量用例的 CPU 时间少约一成，且没有 vmThreads 的跨 realm 坑（`new File([blob])` 会读成空）。
    pool: 'threads',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // 默认 5s 对「渲染整个 App + 打开懒加载页面」这类集成用例太紧：并行跑时 jsdom 一慢就假红。
    // 放宽到 20s 只是去掉噪音，逻辑卡死仍会因为超时暴露出来。
    testTimeout: 20000,
  },
})
