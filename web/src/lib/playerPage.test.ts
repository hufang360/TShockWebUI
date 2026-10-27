import { describe, expect, it } from 'vitest'
import { formatPlayTime, formatSaveTime } from './playerPage'

describe('游玩时长格式', () => {
  it('固定 HH:MM:SS，小时不封顶；没有数据返回空串', () => {
    expect(formatPlayTime(1346173192961)).toBe('37:23:37') // 134617.3 秒
    expect(formatPlayTime(10_000_000 * 60)).toBe('00:01:00')
    expect(formatPlayTime(10_000_000 * 8000)).toBe('02:13:20') // 2h13m20s
    expect(formatPlayTime(0)).toBe('')
    expect(formatPlayTime(undefined)).toBe('')
  })
})

describe('最后保存时间格式', () => {
  // 存档里存的是 DateTime.UtcNow.ToBinary() → 换成本地时区显示，不做 UTC 直出。
  const iso = '2026-10-26T14:05:00.000Z'
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(iso)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  it('按浏览器本地时区显示 YYYY-MM-DD HH:mm', () => {
    expect(formatSaveTime(iso)).toBe(local)
    expect(formatSaveTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('不是 UTC 时区时，与直接截 ISO 结果不同（防回退）', () => {
    if (d.getTimezoneOffset() !== 0) {
      expect(formatSaveTime(iso)).not.toBe('2026-10-26 14:05')
    }
  })

  it('空值 / 非法值返回空串', () => {
    expect(formatSaveTime(undefined)).toBe('')
    expect(formatSaveTime('')).toBe('')
    expect(formatSaveTime('not-a-date')).toBe('')
  })
})
