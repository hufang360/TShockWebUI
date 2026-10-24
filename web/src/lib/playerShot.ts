import { loadVerifiedAtlasImage } from '@/lib/atlas'
import { iconContentSize, shouldSmooth } from '@/lib/iconScale'
import { PLAYER_FRAME_H, PLAYER_FRAME_W, drawPlayerAvatar } from '@/lib/playerAvatarDraw'
import { loadPlayerAtlas, loadPlayerAtlasImage } from '@/lib/playerAtlas'
import { EQUIP_GROUP_A, EQUIP_GROUP_B, findGroup, type SlotGroup } from '@/lib/playerSlots'
import type { PlayerItem, PlayerLook } from '@/lib/tshock'
import type { AtlasRegions, Dataset } from '@/types'

/**
 * 「导出图片」：把查到的角色画成一张 PNG（人物全身图 + 属性 + 背包 / 装备格）。
 *
 * 为什么不截 DOM：页面里的角色图与物品图标都是 canvas，`html2canvas` / SVG foreignObject
 * 都画不出来；这里直接在 canvas 上按同一套尺寸规则重画一遍（依赖已抽出的
 * `lib/playerAvatarDraw.ts` 与 `lib/iconScale.ts`），不引入新依赖、也不受主题/滚动位置影响。
 *
 * 布局是**纯函数**（`buildPlayerShotLayout`，可单测）；绘制需要 canvas 2d 上下文。
 */

/** 四周留白。 */
const PAD = 24
/** 单个格子边长与格子间距（与页面背包格 36px 一致）。 */
const SLOT = 36
const SLOT_GAP = 4
const SLOT_PITCH = SLOT + SLOT_GAP
/** 分组标题高度（标题 + 与格子之间的空隙）。 */
const TITLE_H = 16
const TITLE_GAP = 4
/** 背包主格列数（游戏背包 10 列）。 */
const INV_COLS = 10
/** 人物图放大倍数（40×56 × 4 = 160×224）。 */
const AVATAR_SCALE = 4
const AVATAR_W = PLAYER_FRAME_W * AVATAR_SCALE
const AVATAR_H = PLAYER_FRAME_H * AVATAR_SCALE
/** 背包与钱币 / 弹药列、装备分组之间的间距。 */
const COL_GAP = 16
const GROUP_GAP = 8
const EQUIP_GAP = 18

export type ShotTone = 'fg' | 'muted'

export interface ShotText {
  x: number
  y: number
  text: string
  size: number
  tone: ShotTone
  weight?: 400 | 600
}

export interface ShotSlot {
  x: number
  y: number
  item: PlayerItem
}

export interface ShotGroup {
  key: string
  label: string
  titleX: number
  titleY: number
  slots: ShotSlot[]
}

export interface PlayerShotLayout {
  width: number
  height: number
  name: ShotText
  status: ShotText
  avatar: { x: number; y: number; scale: number }
  info: ShotText[]
  groups: ShotGroup[]
  /** 格子边长（绘制用；布局与绘制共用同一常量）。 */
  slot: number
}

/** 文案（由页面按当前语言传入，lib 层不碰 i18n）。 */
export interface ShotLabels {
  /** 状态行（在线 / 离线 / 本地存档…）。 */
  status: string
  /** 属性行（「生命 120 / 200」…），按顺序逐行画。 */
  info: string[]
  /** 分组标题：`players.group.*` → 本地化名。 */
  groups: Record<string, string>
}

/**
 * 取分组里的格子：数据不足（如测试 / 旧数据只回一部分）时补空格，
 * 让导出的背包 / 装备始终是完整的格阵（与游戏截图一致）。
 */
function slotItems(look: PlayerLook, group: SlotGroup): PlayerItem[] {
  return Array.from(
    { length: group.count },
    (_, i) =>
      look.items[group.start + i] ?? {
        slot: group.start + i,
        id: 0,
        stack: 0,
        prefix: 0,
        favorited: false,
      },
  )
}

function layoutSlots(
  items: PlayerItem[],
  cols: number,
  x: number,
  y: number,
): ShotSlot[] {
  return items.map((item, i) => ({
    x: x + (i % cols) * SLOT_PITCH,
    y: y + Math.floor(i / cols) * SLOT_PITCH,
    item,
  }))
}

function group(
  key: string,
  label: string,
  items: PlayerItem[],
  cols: number,
  x: number,
  y: number,
): ShotGroup {
  return { key, label, titleX: x, titleY: y, slots: layoutSlots(items, cols, x, y + TITLE_H + TITLE_GAP) }
}

/**
 * 计算图片尺寸与每个元素的落点（纯函数）。
 *
 * 版面：标题（名称 + 状态）→ 人物全身图 + 属性 → 背包（10×5，垃圾桶在右下角）+ 钱币 / 弹药列
 * → 装备区五列（杂项染料 / 杂项装备 → 染料 / 时装 / 装备）。与页面「简约视图」一致，不含银行与配装。
 */
export function buildPlayerShotLayout(look: PlayerLook, labels: ShotLabels): PlayerShotLayout {
  const nameY = PAD
  const statusY = nameY + 30
  const avatarY = statusY + 26
  const infoX = PAD + AVATAR_W + 24
  const infoY = avatarY + 4
  const backpackY = avatarY + AVATAR_H + EQUIP_GAP
  const backpackW = INV_COLS * SLOT_PITCH - SLOT_GAP
  const coinsX = PAD + backpackW + COL_GAP
  const ammoX = coinsX + SLOT_PITCH
  const trashX = PAD + (INV_COLS - 1) * SLOT_PITCH
  const trashY = backpackY + TITLE_H + TITLE_GAP + 5 * SLOT_PITCH
  const gridY = backpackY + TITLE_H + TITLE_GAP
  const equipY = trashY + SLOT + EQUIP_GAP

  const groups: ShotGroup[] = [
    group('players.group.inventory', labels.groups['players.group.inventory'] ?? '', slotItems(look, findGroup('players.group.inventory')), INV_COLS, PAD, backpackY),
    group('players.group.coins', labels.groups['players.group.coins'] ?? '', slotItems(look, findGroup('players.group.coins')), 1, coinsX, gridY),
    group('players.group.ammo', labels.groups['players.group.ammo'] ?? '', slotItems(look, findGroup('players.group.ammo')), 1, ammoX, gridY),
    group('players.group.trash', labels.groups['players.group.trash'] ?? '', slotItems(look, findGroup('players.group.trash')), 1, trashX, trashY - (TITLE_H + TITLE_GAP)),
  ]

  // 装备区：B 组（杂项染料 / 杂项装备）在左，A 组（染料 / 时装 / 装备）在右，组间留大一点的空隙。
  let x = PAD
  let equipBottom = equipY
  const equipKeys = [...EQUIP_GROUP_B, ...EQUIP_GROUP_A]
  equipKeys.forEach((key, i) => {
    if (i === EQUIP_GROUP_B.length) x += GROUP_GAP
    const items = slotItems(look, findGroup(key))
    const g = group(key, labels.groups[key] ?? '', items, 1, x, equipY)
    groups.push(g)
    x += SLOT_PITCH
    const bottom = equipY + TITLE_H + TITLE_GAP + Math.max(1, items.length) * SLOT_PITCH - SLOT_GAP
    equipBottom = Math.max(equipBottom, bottom)
  })

  const infoCount = Math.max(1, labels.info.length)
  const infoBottom = infoY + (infoCount - 1) * 22 + 18
  const height = Math.max(equipBottom, infoBottom) + PAD
  const width = Math.max(ammoX + SLOT, x - SLOT_GAP) + PAD

  return {
    width,
    height,
    name: { x: PAD, y: nameY, text: look.name || '—', size: 20, tone: 'fg', weight: 600 },
    status: { x: PAD, y: statusY, text: labels.status, size: 12, tone: 'muted' },
    avatar: { x: PAD, y: avatarY, scale: AVATAR_SCALE },
    info: labels.info.map((text, i) => ({
      x: infoX,
      y: infoY + i * 22,
      text,
      size: 13,
      tone: 'muted' as const,
    })),
    groups,
    slot: SLOT,
  }
}

/** 图片文件名（保留玩家名，去掉文件系统不允许的字符）。 */
export function playerShotFilename(name: string): string {
  const safe = (name || 'player')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `${safe || 'player'}.png`
}

interface ShotColors {
  bg: string
  fg: string
  muted: string
  border: string
  accent: string
}

const FALLBACK_COLORS: ShotColors = {
  bg: '#ffffff',
  fg: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accent: '#f1f5f9',
}

/** 从主题 CSS 变量取色（浅色 / 深色主题导出各自的配色）。 */
function readColors(): ShotColors {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK_COLORS
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    bg: pick('--card', FALLBACK_COLORS.bg),
    fg: pick('--foreground', FALLBACK_COLORS.fg),
    muted: pick('--muted-foreground', FALLBACK_COLORS.muted),
    border: pick('--border', FALLBACK_COLORS.border),
    accent: pick('--accent', FALLBACK_COLORS.accent),
  }
}

export interface RenderPlayerShotOptions {
  look: PlayerLook
  layout: PlayerShotLayout
  dataset: Dataset | null
  /** 输出像素比（默认 2，文字与图标更清晰）。 */
  pixelRatio?: number
}

/**
 * 按布局把角色画到 canvas（不含下载）。
 * 玩家图集 / 物品图集任一加载失败时对应部分留白，不抛错（导出仍然可用）。
 */
export async function renderPlayerShotCanvas({
  look,
  layout,
  dataset,
  pixelRatio = 2,
}: RenderPlayerShotOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(layout.width * pixelRatio)
  canvas.height = Math.round(layout.height * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.scale(pixelRatio, pixelRatio)

  const colors = readColors()
  // 背景 + 细边框（圆角，与卡片一致）
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, layout.width, layout.height)

  const text = (t: ShotText, color: string) => {
    ctx.fillStyle = color
    ctx.textBaseline = 'top'
    ctx.font = `${t.weight ?? 400} ${t.size}px ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(t.text, t.x, t.y)
  }
  text(layout.name, colors.fg)
  text(layout.status, colors.muted)
  for (const line of layout.info) text(line, colors.muted)

  // 人物图：浅色底框衬托（与页面一致）
  ctx.fillStyle = colors.accent
  ctx.globalAlpha = 0.6
  ctx.fillRect(layout.avatar.x - 8, layout.avatar.y - 8, AVATAR_W + 16, AVATAR_H + 16)
  ctx.globalAlpha = 1
  try {
    const atlas = await loadPlayerAtlas()
    const image = await loadPlayerAtlasImage(atlas)
    drawPlayerAvatar(ctx, {
      look,
      atlas,
      image,
      x: layout.avatar.x,
      y: layout.avatar.y,
      scale: layout.avatar.scale,
    })
  } catch {
    /* 图集缺失：人物区留白 */
  }

  // 物品图集（没有数据 / 加载失败时不画图标，只画空框）
  let atlas = dataset?.atlas
  let atlasImage: HTMLImageElement | null = null
  if (atlas) {
    try {
      atlasImage = await loadVerifiedAtlasImage(atlas)
    } catch {
      atlasImage = null
    }
  }

  for (const g of layout.groups) {
    if (g.slots.length > 0) {
      text({ x: g.titleX, y: g.titleY, text: g.label, size: 12, tone: 'muted' }, colors.muted)
    }
    for (const slot of g.slots) {
      drawSlotFrame(ctx, slot.x, slot.y, colors)
      if (!atlas || !atlasImage) continue
      drawItem(ctx, slot, atlas.regions[String(itemIconKey(dataset, slot.item))], atlasImage)
    }
  }

  return canvas
}

function itemIconKey(dataset: Dataset | null, item: PlayerItem): number {
  const found = dataset?.itemsById.get(item.id)
  return found?.icon ?? item.id
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  // 老浏览器兜底（方角）
  ctx.rect(x, y, w, h)
}

function drawSlotFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: ShotColors,
) {
  ctx.save()
  roundRect(ctx, x + 0.5, y + 0.5, SLOT - 1, SLOT - 1, 4)
  ctx.fillStyle = colors.accent
  ctx.globalAlpha = 0.5
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = colors.border
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/** 在格子里画物品图标（尺寸规则与页面 `ItemIcon` 相同：`game` 模式只缩不放）。 */
function drawItem(
  ctx: CanvasRenderingContext2D,
  slot: ShotSlot,
  region: AtlasRegions[string] | undefined,
  image: CanvasImageSource,
) {
  const item = slot.item
  if (!item || item.id <= 0 || !region) return
  const [sx, sy, w, h] = region
  const content = iconContentSize(w, h, SLOT)
  const dx = slot.x + (SLOT - content.width) / 2
  const dy = slot.y + (SLOT - content.height) / 2
  ctx.save()
  ctx.imageSmoothingEnabled = shouldSmooth(w, content.width)
  ctx.drawImage(image, sx, sy, w, h, dx, dy, content.width, content.height)
  ctx.restore()

  if (item.stack > 1) {
    ctx.save()
    ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'right'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.fillStyle = '#ffffff'
    const tx = slot.x + SLOT - 2
    const ty = slot.y + SLOT - 2
    ctx.strokeText(String(item.stack), tx, ty)
    ctx.fillText(String(item.stack), tx, ty)
    ctx.restore()
  }
}

/** canvas → PNG Blob。 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前浏览器不支持导出图片'))
      return
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出图片失败'))
    }, 'image/png')
  })
}

/** 一步到位：布局 → 绘制 → PNG Blob（供页面直接下载）。 */
export async function renderPlayerShot(
  look: PlayerLook,
  labels: ShotLabels,
  dataset: Dataset | null,
  pixelRatio = 2,
): Promise<Blob> {
  const layout = buildPlayerShotLayout(look, labels)
  const canvas = await renderPlayerShotCanvas({ look, layout, dataset, pixelRatio })
  return canvasToBlob(canvas)
}
