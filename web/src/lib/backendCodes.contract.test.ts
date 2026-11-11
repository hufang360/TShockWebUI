// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_CODE_KINDS } from './httpTransport'

/**
 * 前后端错误码契约（铁律：「产品出现异常信息时，不再让用户感到迷惑」）。
 *
 * 后端在 `server/internal/api/handlers.go` 用 `code*` 常量发错误码；前端靠
 * `BACKEND_CODE_KINDS` 把它归类，决定是「回登录 / 提示权限 / 原样展示上游文案」。
 * 后端新增一个码而前端忘了表态时，前端会静默当成 `bad_response` —— 用户看到
 * 一句对不上号的报错。这条测试就是那个守门人：读 Go 源码，双向比对。
 */

const HANDLERS = resolve(process.cwd(), '../server/internal/api/handlers.go')

/** 后端所有错误码字面量（`codeFoo = "foo_bar"`）。 */
function backendCodes(): string[] {
  const src = readFileSync(HANDLERS, 'utf8')
  const found = new Set<string>()
  for (const m of src.matchAll(/^\s*code[A-Za-z]+\s*=\s*"([a-z_]+)"$/gm)) found.add(m[1])
  if (found.size === 0) {
    // 常量被改名 / 挪走时不要「零个码 = 全绿」，直接炸出来。
    throw new Error(`${HANDLERS} 里没解析到任何 code 常量，解析规则该更新了`)
  }
  return [...found].sort()
}

describe('错误码契约', () => {
  it('后端发出的每个错误码，前端都显式表过态', () => {
    const known = new Set(Object.keys(BACKEND_CODE_KINDS))
    const missing = backendCodes().filter((code) => !known.has(code))
    expect(
      missing,
      `后端新增了错误码但前端没归类：${missing.join(', ')}\n` +
        '在 web/src/lib/httpTransport.ts 的 BACKEND_CODE_KINDS 里补一行（并想清楚用户该看到什么）。',
    ).toEqual([])
  })

  it('前端归类的码，后端确实会发（避免留着已删除的码）', () => {
    const backend = new Set(backendCodes())
    const stale = Object.keys(BACKEND_CODE_KINDS).filter((code) => !backend.has(code))
    expect(stale, `前端还在归类后端已经不发的码：${stale.join(', ')}`).toEqual([])
  })

  it('每个码都归到一个非兜底的类别（不许静默掉进 bad_response 的默认分支）', () => {
    for (const [code, kind] of Object.entries(BACKEND_CODE_KINDS)) {
      expect(kind, `${code} 没有归类`).toBeTruthy()
      // bad_response 是「说不清」的兜底；基础设施类显式写进去是允许的，但业务码不行。
      if (kind === 'bad_response') {
        expect(
          ['bad_response', 'not_found', 'method_not_allowed', 'server_error'],
          `${code} 属于业务错误，不该按 bad_response 处理`,
        ).toContain(code)
      }
    }
  })
})
