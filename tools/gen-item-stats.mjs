#!/usr/bin/env node
/**
 * gen-item-stats.mjs —— 把 GameDump 导出的物品属性整理为 data/item-stats.json。
 *
 * 工具提示行的**顺序与内容**复刻自
 *   TR_SRC/Terraria/Main.cs  MouseText_DrawItemTooltip_GetLinesInfo()
 * 文案取自官方本地化 JSON（zh-Hans / en-US）。
 * 与游戏内差异：不含玩家/NPC/世界状态相关的行（前缀对比、专家世界提示、
 * 召唤栏位数量等），伤害与暴击使用物品基础值而非玩家加成后的值。
 *
 * 输入：TR_SRC、items-raw.json、data/items.json
 * 输出：
 *   data/item-stats.json                 仅 stats（语言无关）
 *   data/item-tips.zh-Hans.json         仅 tip 行（按语言拆分）
 *   data/item-tips.en-US.json           仅 tip 行（按语言拆分）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458');
const RAW = process.env.RAW || '/tmp/items-raw.json';
const OUT = process.env.OUT || join(HERE, '..', 'data', 'item-stats.json');

const parseJsonLoose = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/,(\s*[}\]])/g, '$1'));

// ── 本地化 ──────────────────────────────────────────────────
// 键位占位符（游戏用当前绑定替换；这里给固定、可读的展示名）
const INPUT_SUBS = {
  zh: { InputTrigger_Healing: '快速治疗', InputTrigger_ManaHealing: '快速回蓝', InputTrigger_QuickBuff: '快速增益', InputTrigger_Mount: '骑乘', InputTrigger_UseOrAttack: '使用/攻击', InputTrigger_InteractWithTile: '交互', InputTrigger_ToggleOrOpen: '开启/切换' },
  en: { InputTrigger_Healing: 'Quick Heal', InputTrigger_ManaHealing: 'Quick Mana', InputTrigger_QuickBuff: 'Quick Buff', InputTrigger_Mount: 'Mount', InputTrigger_UseOrAttack: 'Use/Attack', InputTrigger_InteractWithTile: 'Interact', InputTrigger_ToggleOrOpen: 'Open/Toggle' },
};

function makeLoc(culture) {
  const names = ['', '.Items', '.Game', '.NPCs', '.Legacy'];
  const tables = names
    .map((n) => join(TR_SRC, `Terraria.Localization.Content.${culture}${n}.json`))
    .filter(existsSync)
    .map(parseJsonLoose);
  const raw = (key) => {
    const parts = key.split('.');
    for (const t of tables) {
      let cur = t;
      for (const p of parts) { cur = cur?.[p]; if (cur === undefined) break; }
      if (typeof cur === 'string') return cur;
    }
    return null;
  };
  const subs = INPUT_SUBS[culture.startsWith('zh') ? 'zh' : 'en'];
  // 语言包里的 {$Key} 全局替换（最多几层）
  const expand = (s) => {
    let cur = s;
    for (let i = 0; i < 4 && /\{\$[^}]+\}/.test(cur); i++) {
      cur = cur.replace(/\{\$([^}]+)\}/g, (_, k) => raw(k) ?? '');
    }
    return cur.replace(/\{(InputTrigger_\w+)\}/g, (_, k) => subs[k] ?? '');
  };
  return (key, ...args) => {
    const s = raw(key);
    if (s == null) return null;
    let out = expand(s);
    if (args.length) out = out.replace(/\{(\d+)\}/g, (_, i) => (args[Number(i)] ?? ''));
    return out;
  };
}
const locZh = makeLoc('zh-Hans');
const locEn = makeLoc('en-US');

// ── 宠物 buff 集合（Main.Initialize_Entities 里的字面量）────────
function parsePetBuffs() {
  const src = readFileSync(join(TR_SRC, 'Terraria', 'Main.cs'), 'utf8');
  const set = (re) => new Set([...src.matchAll(re)].map((m) => Number(m[1])));
  return {
    vanity: set(/vanityPet\[(\d+)\] = true;/g),
    light: set(/lightPet\[(\d+)\] = true;/g),
  };
}
const PETS = parsePetBuffs();

// ── 文案 ────────────────────────────────────────────────────
/** 同一 key 中英各取一份；两端都缺失时跳过该行。 */
const T = (zhKey, enKey = zhKey, ...args) => {
  const zh = locZh(zhKey, ...args);
  const en = locEn(enKey, ...args);
  return zh || en ? { zh, en } : null;
};

const SPEED_TIP = ['LegacyTooltip.6', 'LegacyTooltip.7', 'LegacyTooltip.8', 'LegacyTooltip.9',
  'LegacyTooltip.10', 'LegacyTooltip.11', 'LegacyTooltip.12', 'LegacyTooltip.13'];
const KB_TIP = ['LegacyTooltip.14', 'LegacyTooltip.15', 'LegacyTooltip.16', 'LegacyTooltip.17',
  'LegacyTooltip.18', 'LegacyTooltip.19', 'LegacyTooltip.20', 'LegacyTooltip.21', 'LegacyTooltip.22'];

function composeTip(it, names) {
  const out = [];
  const push = (pair) => { if (pair && pair.zh != null) out.push(pair); };

  if (it.social && !it.vanity && !it.hasVanityEffects) push(T('LegacyTooltip.61'));

  // 金币（71–74）只在背包里有 CoinGun(905) 时才由游戏显示伤害/暴击/速度/击退行；
  // 图鉴没有玩家上下文，按「没有 Coin Gun」的默认行为隐藏这些行（Main.cs:20873）。
  const coinNeedsCoinGun = it.type >= 71 && it.type <= 74;
  if (it.damage > 0 && (!it.notAmmo || it.useStyle !== 0) && !coinNeedsCoinGun) {
    const dmg = Math.trunc(it.damage * it.tooltipDamageMultiplier);
    const suffixKey = it.melee ? 'LegacyTooltip.2' : it.ranged ? 'LegacyTooltip.3'
      : it.magic ? 'LegacyTooltip.4' : it.summon ? 'LegacyTooltip.53' : 'LegacyTooltip.55';
    const suffix = { zh: locZh(suffixKey), en: locEn(suffixKey) };
    out.push({ zh: `${dmg}${suffix.zh ?? ''}`, en: `${dmg}${suffix.en ?? ''}` });
    if (it.melee || it.ranged || it.magic) {
      const crit = 4 + it.crit;
      out.push({ zh: `${crit}${locZh('LegacyTooltip.5') ?? ''}`, en: `${crit}${locEn('LegacyTooltip.5') ?? ''}` });
    }
    const a = it.useAnimation;
    const speedKey = a <= 8 ? SPEED_TIP[0] : a <= 20 ? SPEED_TIP[1] : a <= 25 ? SPEED_TIP[2]
      : a <= 30 ? SPEED_TIP[3] : a <= 35 ? SPEED_TIP[4] : a <= 45 ? SPEED_TIP[5]
        : a <= 55 ? SPEED_TIP[6] : SPEED_TIP[7];
    if (it.useStyle !== 0 && (!it.summon || it.whip)) push(T(speedKey));
    const kb = it.knockBack;
    const kbKey = kb === 0 ? KB_TIP[0] : kb <= 1.5 ? KB_TIP[1] : kb <= 3 ? KB_TIP[2]
      : kb <= 4 ? KB_TIP[3] : kb <= 6 ? KB_TIP[4] : kb <= 7 ? KB_TIP[5]
        : kb <= 9 ? KB_TIP[6] : kb <= 11 ? KB_TIP[7] : KB_TIP[8];
    push(T(kbKey));
  }

  if (it.fishingPole > 0) {
    push(T('GameUI.PrecentFishingPower', 'GameUI.PrecentFishingPower', it.fishingPole));
    push(T('GameUI.BaitRequired'));
  }
  if (it.bait > 0) push(T('GameUI.BaitPower', 'GameUI.BaitPower', it.bait));

  const isPet = it.buffType > 0 && (PETS.vanity.has(it.buffType) || PETS.light.has(it.buffType));
  const equippable = it.headSlot > 0 || it.bodySlot > 0 || it.legSlot > 0 || it.accessory ||
    it.hook || it.mountType !== -1 || isPet;
  if (equippable) push(T('LegacyTooltip.23'));

  if (it.tileWand > 0) push({ zh: (locZh('LegacyTooltip.52') ?? '') + (names[it.tileWand]?.zh ?? ''), en: (locEn('LegacyTooltip.52') ?? '') + (names[it.tileWand]?.en ?? '') });
  if (it.questItem) push(T('LegacyInterface.65'));
  if (it.vanity) push(T('LegacyTooltip.24'));
  if (it.defense > 0) push({ zh: `${it.defense}${locZh('LegacyTooltip.25') ?? ''}`, en: `${it.defense}${locEn('LegacyTooltip.25') ?? ''}` });
  if (it.pick > 0) push({ zh: `${it.pick}${locZh('LegacyTooltip.26') ?? ''}`, en: `${it.pick}${locEn('LegacyTooltip.26') ?? ''}` });
  if (it.axe > 0) push({ zh: `${it.axe * 5}${locZh('LegacyTooltip.27') ?? ''}`, en: `${it.axe * 5}${locEn('LegacyTooltip.27') ?? ''}` });
  if (it.hammer > 0) push({ zh: `${it.hammer}${locZh('LegacyTooltip.28') ?? ''}`, en: `${it.hammer}${locEn('LegacyTooltip.28') ?? ''}` });
  if (it.tileBoost !== 0) {
    const v = it.tileBoost;
    push({ zh: `${v > 0 ? '+' : ''}${v}${locZh('LegacyTooltip.54') ?? ''}`, en: `${v > 0 ? '+' : ''}${v}${locEn('LegacyTooltip.54') ?? ''}` });
  }
  if (it.healLife > 0) {
    push(it.type === 3001
      ? T('CommonItemTooltip.RestoresLifeRange', 'CommonItemTooltip.RestoresLifeRange', it.healLife, 120)
      : T('CommonItemTooltip.RestoresLife', 'CommonItemTooltip.RestoresLife', it.healLife));
  }
  if (it.healMana > 0) push(T('CommonItemTooltip.RestoresMana', 'CommonItemTooltip.RestoresMana', it.healMana));
  if (it.buffType > 0 && !it.summon && !isPet) push(T('CommonItemTooltip.Buffs'));
  else if (it.healLife > 0) push(T('CommonItemTooltip.Healing'));
  else if (it.healMana > 0) push(T('CommonItemTooltip.ManaHealing'));
  else if (it.mountType > 0 && !it.mountCart) push(T('CommonItemTooltip.Mount'));
  if (it.mana > 0) push(T('CommonItemTooltip.UsesMana', 'CommonItemTooltip.UsesMana', it.mana));

  const placeable = it.createWall > 0 || it.createTile > -1 || it.type === 849;
  if (placeable) {
    if (it.placeTileOnAltUse || it.consumable) push(T('LegacyTooltip.33'));
  } else if (it.ammo > 0 && !it.notAmmo) {
    push(T('LegacyTooltip.34'));
  } else if (it.consumable && !it.chlorophyteExtractinatorConsumable) {
    push(T('LegacyTooltip.35'));
  }
  if (it.material) push(T('LegacyTooltip.36'));
  if (it.wireable) push(T('CommonItemTooltip.Wireable'));
  if (it.container) push(T('CommonItemTooltip.Container'));
  if (it.wireTrigger) push(T('CommonItemTooltip.WireTrigger'));

  // 物品独有文案 ItemTooltip.<内部名>（可用 \n 分行）
  for (const key of ['zh', 'en']) {
    const vol = key === 'zh' ? locZh : locEn;
    const raw = vol(`ItemTooltip.${it.key}`);
    if (raw) for (const line of raw.split('\n')) out.push({ [key]: line });
  }

  if (it.buffTime > 0) {
    const seconds = Math.round(it.buffTime / 60);
    if (it.buffTime / 60 < 60) push(T('CommonItemTooltip.SecondDuration', 'CommonItemTooltip.SecondDuration', seconds));
    else push(T('CommonItemTooltip.MinuteDuration', 'CommonItemTooltip.MinuteDuration', Math.round(seconds / 60)));
  }
  if (it.expert) push(T('GameUI.Expert'));
  if (it.rare === -13) push(T('GameUI.Master'));

  return out;
}

// ── 主流程 ──────────────────────────────────────────────────
const raw = parseJsonLoose(RAW);
// 物品 id → 「内部名 → 官方本地化名」。物品名现在只在 loc.<culture>.json 里，
// 这里用 item.key 反查本地化文件（tileWand 提示需要目标物品名）。
const names = {};
try {
  for (const item of parseJsonLoose(join(HERE, '..', 'data', 'items.json')).items) {
    names[item.id] = {
      zh: locZh('ItemName.' + item.key) || item.key,
      en: locEn('ItemName.' + item.key) || item.key,
    };
  }
} catch { /* 可选 */ }

const NUM_KEYS = ['damage', 'crit', 'knockBack', 'useAnimation', 'defense', 'pick', 'axe', 'hammer',
  'tileBoost', 'fishingPole', 'bait', 'mana', 'healLife', 'healMana', 'manaIncrease', 'lifeRegen',
  'buffType', 'buffTime', 'rare', 'value', 'ammo', 'useAmmo', 'createTile', 'createWall', 'shoot', 'shootSpeed',
  'decraftStack'];
const BOOL_KEYS = ['autoReuse', 'melee', 'ranged', 'magic', 'summon', 'sentry', 'accessory', 'vanity',
  'material', 'consumable', 'questItem', 'expert', 'whip', 'hook', 'canDecraft'];

const items = {};
const tipsZh = {};
const tipsEn = {};
let tipCount = 0;
for (const [idStr, it] of Object.entries(raw.items)) {
  const id = Number(idStr);
  it.type = id;
  const lines = composeTip(it, names);
  const zh = lines.map((l) => l.zh).filter((x) => x != null);
  const en = lines.map((l) => l.en).filter((x) => x != null);
  const stats = {};
  for (const k of NUM_KEYS) {
    const v = it[k];
    if (!v) continue;
    if ((k === 'createTile' || k === 'damage' || k === 'shoot' || k === 'ammo' || k === 'useAmmo') && v < 0) continue;
    if (k === 'createWall' && v < 0) continue;
    stats[k] = v;
  }
  for (const k of BOOL_KEYS) if (it[k]) stats[k] = true;
  if (it.mountType > 0) stats.mountType = it.mountType;
  if (Object.keys(stats).length) items[id] = { stats };
  if (zh.length) { tipsZh[id] = zh; tipCount++; }
  if (en.length) tipsEn[id] = en;
}

const tipMeta = {
  gameVersion: raw.gameVersion,
  itemCount: raw.itemCount,
  itemsWithTip: tipCount,
  source: 'Terraria.Main.MouseText_DrawItemTooltip_GetLinesInfo() @ OTAPI ' + raw.gameVersion,
  generatedBy: 'tools/gen-item-stats.mjs',
  note: '伤害/暴击为物品基础值；不含前缀与玩家/世界状态相关行',
};

const payload = { meta: tipMeta, items };
writeFileSync(OUT, JSON.stringify(payload, null, 1));
// tips 按语言拆分，紧凑写出（体积敏感）。
const dir = dirname(OUT);
writeFileSync(join(dir, 'item-tips.zh-Hans.json'), JSON.stringify({ meta: tipMeta, items: tipsZh }) + '\n');
writeFileSync(join(dir, 'item-tips.en-US.json'), JSON.stringify({ meta: tipMeta, items: tipsEn }) + '\n');
console.log(`item-stats: ${Object.keys(items).length} items, ${tipCount} with tip -> ${OUT}`);
console.log(`  item-tips.zh-Hans.json (${Object.keys(tipsZh).length}) / item-tips.en-US.json (${Object.keys(tipsEn).length})`);
