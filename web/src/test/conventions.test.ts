// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 全仓约定护栏（扫源码，不渲染）。
 *
 * 一条规则管整个仓库，比「给某个组件的 className 写断言」划算：新写的代码自动被管，
 * 跑一次几十毫秒。思路照搬 `components/ui/iconButtons.test.tsx`。
 *
 * 每个 allowlist 条目都必须写清「为什么可以例外」——不写理由就是留口子。
 */

const SRC = resolve(process.cwd(), 'src')

/** 扫出来时相对 `src/` 的路径，统一用正斜杠；`src/test/` 是测试设施，不参与。 */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'test') sourceFiles(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

const FILES = sourceFiles().map((path) => ({
  rel: relative(SRC, path).split('\\').join('/'),
  path,
}))

interface Rule {
  /** 用例标题 */
  name: string
  /** 违规写法 */
  pattern: RegExp
  /** 允许例外：文件 → 为什么 */
  allow?: Record<string, string>
  /** 违规后提示怎么改 */
  why: string
}

const RULES: Rule[] = [
  {
    name: '只用语义色令牌，不写裸 Tailwind 色板',
    pattern:
      /\b(?:text|bg|border|ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    allow: { 'components/ItemTooltipContent.tsx': '物品提示框刻意模仿游戏内深色浮窗，不跟随界面主题' },
    why: '裸色板不跟主题走，明暗切换后会瞎；改用 text-warning / bg-card 这类语义令牌',
  },
  {
    name: '不用 dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML/,
    why: '富文本已由 RichText / ItemTooltipContent 自己分词渲染，不需要注入 HTML',
  },
  {
    name: '业务代码不直接碰 localStorage / sessionStorage（统一走 lib/storage）',
    pattern: /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)\b/,
    allow: {
      'lib/storage.ts': '统一入口的实现本身（前缀、隐私模式降级、跨标签页同步）',
      'pages/CommandPage.tsx': '清理 react-resizable-panels 自带的库内 key，不属于 StorageKeys 命名空间',
    },
    why: '绕开 lib/storage 会丢掉 "tswui:" 前缀与隐私模式降级，也让「哪些数据落盘」变得不可审计',
  },
  {
    name: '只有传输层能请求 /api（否则统一错误码处理会被绕过）',
    pattern: /\bfetch\(\s*(?:`\$\{API_BASE\}|['"`]\/api\/)/,
    allow: { 'lib/httpTransport.ts': '传输层实现本身：统一 CSRF 头、错误码分类、token 失效回登录' },
    why: '绕过 httpTransport 就拿不到 token 失效回登录、统一错误分类与 CSRF 头',
  },
  {
    name: '只有 App 与 lib/routes 能直接读写 location.hash',
    pattern: /window\.location\.hash/,
    allow: {
      'App.tsx': '应用外壳：把当前 tab 同步到地址栏',
      'lib/routes.ts': 'hash ↔ TabId 映射的唯一实现（含旧地址兼容）',
    },
    why: '路由散落会让深链接与「直达 URL 回首页」的逻辑互相打架',
  },
]

interface ScanResult {
  violations: string[]
  /** allowlist 里写着、但已经不再违规的文件（理由过期了） */
  stale: string[]
}

function scan(rule: Rule): ScanResult {
  const re = new RegExp(rule.pattern.source, 'g')
  const violations: string[] = []
  const hit = new Set<string>()
  for (const { rel, path } of FILES) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim()
        // 注释里举例说明不算违规
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line))) {
          hit.add(rel)
          if (!rule.allow || !(rel in rule.allow)) violations.push(`${rel}:${i + 1}: ${m[0]}`)
        }
      })
  }
  const stale = Object.keys(rule.allow ?? {}).filter((rel) => !hit.has(rel))
  return { violations, stale }
}

describe('源码约定', () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      expect(scan(rule).violations, rule.why).toEqual([])
    })
  }
})

describe('allowlist 不腐烂', () => {
  it('例外项要么还在违规、要么该删掉', () => {
    const stale = RULES.flatMap((rule) => scan(rule).stale)
    expect(stale, `这些 allowlist 条目已经不违规了，删掉：${stale.join(', ')}`).toEqual([])
  })
})
