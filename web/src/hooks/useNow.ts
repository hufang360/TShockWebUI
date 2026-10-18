import { useEffect, useState } from 'react'

/**
 * 每 `intervalMs` 更新一次的「当前时间」。用于相对时间文案（如「3 分钟前」）
 * 在页面久开时自动变旧，不必等下一次数据刷新才更新。
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
