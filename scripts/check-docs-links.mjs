#!/usr/bin/env node
/**
 * 全仓 Markdown 相对链接死链检查。
 *
 * 跳过：node_modules / dist / .git / .dev / webdist / .impeccable，以及 `_TEMPLATE.md`（占位链接）。
 * 忽略外链、锚点与代码块 / 行内代码里的内容。
 *
 * 用法：node scripts/check-docs-links.mjs   （或 make docs-check）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.dev', 'webdist', '.impeccable'])
const files = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p)
    } else if (name.endsWith('.md')) {
      files.push(p)
    }
  }
}
walk('.')

const broken = []
for (const file of files) {
  if (file.endsWith('_TEMPLATE.md')) continue
  const dir = dirname(file)
  const text = readFileSync(file, 'utf8')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = m[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    target = target.split('#')[0]
    if (!target) continue
    const abs = resolve(dir, decodeURIComponent(target))
    if (!existsSync(abs)) broken.push(`${relative('.', file)} -> ${m[1]}`)
  }
}

console.log(`md files: ${files.length}, broken: ${broken.length}`)
for (const line of broken.slice(0, 30)) console.log(`  - ${line}`)
if (broken.length > 0) process.exit(1)
