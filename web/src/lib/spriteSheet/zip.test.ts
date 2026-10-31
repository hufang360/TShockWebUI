import { describe, expect, it } from 'vitest'
import { buildZip, crc32, type ZipEntry } from './zip'

const enc = (text: string) => new TextEncoder().encode(text)

interface ParsedCentral {
  name: string
  crc: number
  size: number
  localOffset: number
}

/** 从 ZIP 字节里读中央目录（测试用最简解析器，只读本文件写出的字段）。 */
function parseZip(bytes: Uint8Array): { entries: ParsedCentral[]; comment: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const entries: ParsedCentral[] = []
  let offset = cdOffset
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    entries.push({
      crc: view.getUint32(offset + 16, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
      name: new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen)),
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  const commentLen = view.getUint16(eocd + 20, true)
  const comment = new TextDecoder().decode(bytes.slice(eocd + 22, eocd + 22 + commentLen))
  return { entries, comment }
}

function readLocal(bytes: Uint8Array, localOffset: number): { name: string; data: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
  const nameLen = view.getUint16(localOffset + 26, true)
  const extraLen = view.getUint16(localOffset + 28, true)
  const size = view.getUint32(localOffset + 22, true)
  const start = localOffset + 30 + nameLen + extraLen
  return {
    name: new TextDecoder().decode(bytes.slice(localOffset + 30, localOffset + 30 + nameLen)),
    data: bytes.slice(start, start + size),
  }
}

describe('crc32', () => {
  it('与标准测试向量一致', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('buildZip（store-only）', () => {
  const entries: ZipEntry[] = [
    { name: 'r1c1.png', data: enc('first-slice') },
    { name: 'r1c2.png', data: enc('second-slice-longer') },
    { name: 'r2c1.png', data: new Uint8Array([0, 1, 2, 3, 255]) },
  ]

  it('中央目录记录条目数、名字、CRC 与长度', () => {
    const zip = buildZip(entries, new Date(2026, 0, 2, 3, 4, 5))
    const { entries: parsed, comment } = parseZip(zip)
    expect(comment).toBe('')
    expect(parsed.map((e) => e.name)).toEqual(entries.map((e) => e.name))
    parsed.forEach((entry, index) => {
      expect(entry.crc).toBe(crc32(entries[index].data))
      expect(entry.size).toBe(entries[index].data.length)
    })
  })

  it('本地文件头指向的正是对应数据（可解包）', () => {
    const zip = buildZip(entries)
    const { entries: parsed } = parseZip(zip)
    parsed.forEach((entry, index) => {
      const local = readLocal(zip, entry.localOffset)
      expect(local.name).toBe(entries[index].name)
      expect([...local.data]).toEqual([...entries[index].data])
    })
  })

  it('空条目列表也生成合法的 EOCD', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    expect(parseZip(zip).entries).toEqual([])
  })
})
