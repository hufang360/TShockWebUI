#!/usr/bin/env node
/**
 * gen-tile-name-overrides.mjs —— 生成 data/tile-name-overrides.json（图格 / 墙的中文名补齐表）。
 *
 * 为什么需要它：游戏里图格 / 墙的显示名只有三条来源（见 `web/src/lib/tiles.ts` 的注释）——
 * `MapObject` 地图图例名、图例物品名、代表物品名。**世界里生成、玩家不能放置**的那些
 * （藤蔓、草丛、苔藓砖、未安全墙…）三条都命中不了，只能显示 `Vines` 这种内部常量名。
 * 游戏本身没有给它们官方本地化名，所以这里补一份对照表，名字取自 **Terraria 中文 Wiki**：
 *   - 图格：https://terraria.wiki.gg/zh/wiki/图格 ID（9 个分段子页面，表格列：ID / 子 ID / 图片 / 物品·实体 / 内部名称）
 *   - 墙：  https://terraria.wiki.gg/zh/wiki/墙 ID（表格列：ID / 名称 / 放置后图像 / 内部名称 / 安全墙）
 *
 * **逐条按「内部名称」校验**：Wiki 该行的内部常量名必须等于 `data/tiles.json` / `data/walls.json`
 * 的 `key`，否则跳过并告警 —— 防止版本差异导致 ID 错位、把名字安到别的图格上。
 *
 * 只收录「三条来源都解析不出名字」的 ID（其余一律以游戏数据为准），并把平台标注
 * （`(电脑版、主机版、和移动版)`）与脚注（`[1]`）去掉。
 *
 * 产物入库；重跑需要网络。升级游戏版本后重跑一次，diff 里能看出新增 / 改名的图格。
 *
 * 运行：node tools/gen-tile-name-overrides.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const OUT = process.env.OUT || join(PROJECT, 'data', 'tile-name-overrides.json');

const WIKI_API = 'https://terraria.wiki.gg/zh/api.php';
const TILE_PARTS = 9;
const TILE_PAGE = '图格 ID';
const WALL_PAGE = '墙 ID';

const readJson = (rel) => JSON.parse(readFileSync(join(PROJECT, rel), 'utf8'));

// wiki 会限流（HTTP 429）：串行请求 + 间隔，429 / 5xx 指数退避重试。
const UA = 'TShockWebUI-data-gen/1.0 (+https://github.com/) tools/gen-tile-name-overrides.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 取某个 wiki 页面的渲染 HTML（模板展开后才有中文名）。 */
async function fetchHtml(page) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-encoding': 'identity' } })
    if (res.ok) {
      const data = await res.json()
      if (!data.parse?.text) throw new Error(`${page}: 响应里没有 parse.text`)
      return data.parse.text
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(2000 * 2 ** attempt)
      continue
    }
    throw new Error(`${page}: HTTP ${res.status}`)
  }
}

const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

/** 表格行 → 单元格文本数组。 */
function rowsOf(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => stripTags(c[1])),
  )
}

/**
 * 去掉平台标注 `(电脑版、主机版、和移动版)` 与脚注 `[1]` / `[a]`。
 *
 * 标注可能出现在**名字中间**（`紫晶晶莹宝石块(电脑版…)(黯淡)`），所以不限位置、循环剥；
 * 只匹配括号里含「版」的，`发光蘑菇（生长）`、`武器架（未使用…）` 这类正常括号不受影响。
 */
function cleanName(raw) {
  let name = raw.replace(/\s*\[[^\]]*\]\s*$/g, '').trim()
  for (;;) {
    const next = name.replace(/\s*[（(][^（）()]*版[^（）()]*[）)]/gu, '').trim()
    if (next === name) break
    name = next
  }
  // 去掉括号前的空格、合并连续空白（`魔法冰雪块 （由…）` -> `魔法冰雪块（由…）`）
  return name.replace(/\s+/g, ' ').replace(/\s+([（(])/gu, '$1').trim()
}

/** 图格：取每个 ID 第一行（子 ID 0 那一行带名称与内部名）。 */
async function collectTiles() {
  const out = new Map()
  for (let part = 1; part <= TILE_PARTS; part += 1) {
    const html = await fetchHtml(`${TILE_PAGE}/第 ${part} 部分`)
    await sleep(1200)
    for (const cells of rowsOf(html)) {
      // 列：ID / 子 ID / 图片 / 物品·实体 / 内部名称（内部名只在块首行有，且带 rowspan）
      if (cells.length < 5) continue
      const id = Number(cells[0])
      if (!Number.isInteger(id)) continue
      const name = cleanName(cells[3] ?? '')
      const internal = (cells[4] ?? '').trim()
      if (!name || !internal || out.has(id)) continue
      out.set(id, { name, internal })
    }
  }
  return out
}

/** 墙：ID / 名称 / 放置后图像 / 内部名称 / 安全墙。 */
async function collectWalls() {
  const out = new Map()
  const html = await fetchHtml(WALL_PAGE)
  for (const cells of rowsOf(html)) {
    if (cells.length < 4) continue
    const id = Number(cells[0])
    if (!Number.isInteger(id)) continue
    const name = cleanName(cells[1] ?? '')
    const internal = (cells[3] ?? '').trim()
    if (!name || !internal || out.has(id)) continue
    out.set(id, { name, internal })
  }
  return out
}

function main() {
  return (async () => {
    const tiles = readJson('data/tiles.json').entries
    const walls = readJson('data/walls.json').entries
    const tileNames = readJson('data/tile-names.json')
    const loc = readJson('data/loc.zh-Hans.json')
    const items = new Map(readJson('data/items.json').items.map((it) => [it.id, it]))
    const itemName = (id) => {
      const item = items.get(id)
      return item ? loc.ItemName?.[item.key] : undefined
    }
    /** 与 `web/src/lib/tiles.ts` 的游戏内命名链一致（不含本补丁表）。 */
    const resolveTile = (entry) => {
      const objectKey = tileNames.objects?.[String(entry.id)]
      if (objectKey && loc.MapObject?.[objectKey]) return loc.MapObject[objectKey]
      const legendItem = tileNames.items?.[String(entry.id)]
      if (legendItem != null && itemName(legendItem)) return itemName(legendItem)
      if (entry.item != null && itemName(entry.item)) return itemName(entry.item)
      return null
    }
    const resolveWall = (entry) => (entry.item != null ? itemName(entry.item) : null)

    const wikiTiles = await collectTiles()
    await sleep(1200)
    const wikiWalls = await collectWalls()

    const mismatches = []
    const pick = (entries, wiki, resolve) => {
      const names = {}
      const missingInWiki = []
      for (const entry of entries) {
        if (resolve(entry)) continue
        const hit = wiki.get(entry.id)
        if (!hit) {
          missingInWiki.push(`${entry.id}:${entry.key}`)
          continue
        }
        if (hit.internal !== entry.key) {
          mismatches.push({
            id: entry.id,
            ours: entry.key,
            wiki: hit.internal,
            name: hit.name,
          })
          continue
        }
        names[String(entry.id)] = hit.name
      }
      return { names, missingInWiki }
    }

    const tilePick = pick(tiles, wikiTiles, resolveTile)
    const wallPick = pick(walls, wikiWalls, resolveWall)

    const payload = {
      meta: {
        gameVersion: JSON.parse(readFileSync(join(PROJECT, 'data', 'meta.json'), 'utf8')).gameVersion,
        source:
          'https://terraria.wiki.gg/zh/wiki/图格 ID（9 个分段）+ https://terraria.wiki.gg/zh/wiki/墙 ID',
        generatedBy: 'tools/gen-tile-name-overrides.mjs',
        tileCount: Object.keys(tilePick.names).length,
        wallCount: Object.keys(wallPick.names).length,
        note:
          '只收录游戏内三条命名来源（MapObject / 图例物品 / 代表物品）解析不出来的 ID；' +
          '每条都按内部常量名与 data/tiles.json / data/walls.json 的 key 逐条校验过。' +
          '名称取自中文 Wiki（已去掉平台标注与脚注），升级游戏版本后重跑本脚本即可。',
      },
      tiles: tilePick.names,
      walls: wallPick.names,
    }

    writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`, 'utf8')
    console.log(
      `补齐 ${payload.meta.tileCount} 个图格 / ${payload.meta.wallCount} 个墙 -> ${OUT}`,
    )
    if (mismatches.length) {
      console.warn(`⚠ ${mismatches.length} 条内部名对不上（已跳过）：`, mismatches.slice(0, 10))
    }
    if (tilePick.missingInWiki.length) {
      console.warn(`⚠ ${tilePick.missingInWiki.length} 个图格 Wiki 表里没有：`, tilePick.missingInWiki.slice(0, 10))
    }
    if (wallPick.missingInWiki.length) {
      console.warn(`⚠ ${wallPick.missingInWiki.length} 个墙 Wiki 表里没有：`, wallPick.missingInWiki.slice(0, 10))
    }
  })()
}

await main()
