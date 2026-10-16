/**
 * 传输层入口（兼容旧引用）。
 *
 * 实现已拆分：契约见 `transport.ts`，真实实现见 `httpTransport.ts`，
 * 演示实现见 `mockTransport.ts`。默认使用真实传输（`VITE_TRANSPORT=http`），
 * 仅在显式设置 `VITE_TRANSPORT=mock` 时使用 Mock。
 */

import { HttpTransport } from './httpTransport'
import { MockTransport } from './mockTransport'
import type { BackendTransport } from './transport'

export type {
  BackendTransport,
  BatchCapabilities,
  EventsPage,
  FishBuyResult,
  FishCapabilities,
  FishGood,
  FishShop,
  MeInfo,
  NameItem,
  PlayerCapabilities,
  PlayerItem,
  PlayerLook,
  PluginDataType,
  RuntimeCommand,
  ServerEvent,
  ServerInfo,
  ServerInfoExtra,
  ServerStatus,
  Session,
  SessionInfo,
  TshockErrorKind,
  WebAuthCapabilities,
} from './transport'
export { TshockRequestError, resultFromError, emptyPlayerLook } from './transport'
export { HttpTransport } from './httpTransport'
export { MockTransport, MOCK_PLAYERS } from './mockTransport'

export function createTransport(): BackendTransport {
  const mode = (import.meta.env.VITE_TRANSPORT as string | undefined) ?? 'http'
  return mode === 'mock' ? new MockTransport() : new HttpTransport()
}
