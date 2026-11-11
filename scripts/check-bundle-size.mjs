#!/usr/bin/env node
/**
 * 首屏体积护栏：量「第一次打开页面要下载的字节」，超预算即失败。
 *
 * 为什么需要：web/vite.config.ts 的 treeshake / codeSplitting 是手工调的，谁在 App.tsx 或
 * `@/components/ui` 桶文件里多引一个重组件，首屏就悄悄涨几十 KB，而单测 / 类型检查 / lint 全绿。
 *
 * 量什么：web/dist/index.html 里直接引用的资源（entry script、modulepreload、stylesheet、preload），
 * 外加 codeSplitting 分组产出的 chunk（GROUP_PREFIXES）——后者是静态 import，不一定出现在
 * modulepreload 列表里，但一定在首屏下载。
 *
 * 为什么用 gzip level 6：用户实际下载的是 Go 后端 gzipMiddleware 压缩后的字节，它的默认等级就是 6；
 * 用别的等级量出来的数字与真实体验对不上。
 *
 * 用法：node scripts/check-bundle-size.mjs        （或 make bundle-check，需先 npm run build）
 *   BUNDLE_DIST_DIR=<dir>        量别的构建目录（默认 web/dist）
 *   BUNDLE_MAX_JS_GZIP=<bytes>   临时覆盖预算（用于验证护栏本身会不会响）
 *   BUNDLE_MAX_CSS_GZIP=<bytes>
 * 退出码：0 在预算内 / 1 超预算 / 2 没有构建产物或产物缺文件 / 3 没解析到任何首屏资源（解析规则过时）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = process.env.BUNDLE_DIST_DIR ?? 'web/dist'
const BUDGET_FILE = 'scripts/bundle-budget.json'
/** codeSplitting 的分组名（web/vite.config.ts）。新增分组要同步这里。 */
const GROUP_PREFIXES = ['react', 'vendor-ui']

function fail(code, message) {
  console.error(`✗ ${message}`)
  process.exit(code)
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    fail(2, `读不到 ${path}（先 cd web && npm run build）`)
  }
}

const html = readText(join(DIST, 'index.html'))

// 1) index.html 直接引用的资源
const refs = new Set()
for (const m of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) refs.add(m[1])
for (const m of html.matchAll(/<link\b[^>]*>/g)) {
  const tag = m[0]
  if (!/rel="(?:modulepreload|stylesheet|preload)"/.test(tag)) continue
  const href = /\shref="([^"]+)"/.exec(tag)
  if (href) refs.add(href[1])
}

// 2) codeSplitting 分组产出的 chunk（静态 import，可能没有 modulepreload）
let assets = []
try {
  assets = readdirSync(join(DIST, 'assets'))
} catch {
  fail(2, `读不到 ${join(DIST, 'assets')}（dist 是旧的或构建失败？）`)
}
for (const name of assets) {
  if (!/\.(?:js|css)$/.test(name)) continue
  if (GROUP_PREFIXES.some((p) => name.startsWith(`${p}-`))) refs.add(`/assets/${name}`)
}

const picked = [...refs].filter((href) => href.startsWith('/'))
if (picked.length === 0) {
  fail(3, 'index.html 里没解析到任何首屏资源——解析规则可能过时了（Vite 输出格式变了？）')
}

// 3) 逐个量体积（按 href 去重，同一文件不会重复计）
const rows = []
for (const href of picked.sort()) {
  let buf
  try {
    buf = readFileSync(join(DIST, href.slice(1)))
  } catch {
    fail(2, `index.html 引用了不存在的文件：${href}（dist 是旧的吗？）`)
  }
  rows.push({
    href,
    kind: href.endsWith('.css') ? 'css' : 'js',
    raw: buf.length,
    gzip: gzipSync(buf, { level: 6 }).length,
  })
}

const total = (kind) => rows.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.gzip, 0)
const js = total('js')
const css = total('css')

console.log(`首屏资源（gzip level 6，与后端 gzipMiddleware 一致）  来源：${DIST}`)
for (const r of rows.sort((a, b) => b.gzip - a.gzip)) {
  console.log(
    `  ${r.kind.padEnd(3)} gzip ${String(r.gzip).padStart(7)} B   raw ${String(r.raw).padStart(8)} B   ${r.href}`,
  )
}
console.log(`合计：js ${js} B / css ${css} B`)

// 4) 读预算（环境变量优先，便于验证护栏本身）
function loadBudget() {
  const envJs = Number(process.env.BUNDLE_MAX_JS_GZIP)
  const envCss = Number(process.env.BUNDLE_MAX_CSS_GZIP)
  if (envJs > 0 && envCss > 0) {
    return { initialJsGzipBytes: envJs, initialCssGzipBytes: envCss, source: '环境变量' }
  }
  try {
    const raw = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
    if (raw.initialJsGzipBytes > 0 && raw.initialCssGzipBytes > 0) {
      return { ...raw, source: BUDGET_FILE }
    }
  } catch {
    // 落到下面统一报错
  }
  return null
}

const headroom = (n) => Math.ceil((n * 1.02) / 1024) * 1024

const budget = loadBudget()
if (!budget) {
  console.error(
    `✗ 没有可用的预算（${BUDGET_FILE} 不存在或字段缺失）。按当前体积写入：\n` +
      `  {"initialJsGzipBytes": ${headroom(js)}, "initialCssGzipBytes": ${headroom(css)}}`,
  )
  process.exit(1)
}

const over = []
if (js > budget.initialJsGzipBytes) over.push(`js ${js} > ${budget.initialJsGzipBytes}（超 ${js - budget.initialJsGzipBytes} B）`)
if (css > budget.initialCssGzipBytes) {
  over.push(`css ${css} > ${budget.initialCssGzipBytes}（超 ${css - budget.initialCssGzipBytes} B）`)
}

console.log(`预算（${budget.source}）：js ${budget.initialJsGzipBytes} B / css ${budget.initialCssGzipBytes} B`)
if (over.length > 0) {
  console.error(`✗ 首屏超出预算：${over.join('；')}`)
  console.error('  要么把新增的东西挪出首屏（React.lazy / 动态 import），要么有理由地抬预算：')
  console.error(`  建议值（当前 +2%）：{"initialJsGzipBytes": ${headroom(js)}, "initialCssGzipBytes": ${headroom(css)}}`)
  process.exit(1)
}
console.log(`✓ 在预算内（余量 js ${budget.initialJsGzipBytes - js} B / css ${budget.initialCssGzipBytes - css} B）`)
