#!/usr/bin/env node
/**
 * gen-data.mjs — 生成 TShockWebUI 所需的静态数据（无需 npm 依赖）。
 *
 * 数据来源（全部为本机已有的、可重复生成的文件，不手工编造）：
 *   1. 反编译源码   TR_SRC / Terraria.ID/ItemID.cs      -> 物品 ID ↔ 内部名
 *                  TR_SRC / Terraria.ID/PrefixID.cs    -> 词缀 ID ↔ 内部名
 *                  TR_SRC / Terraria.ID/ItemID.cs(Sets)-> 物品标签（官方集合）
 *                  TR_SRC / Terraria/Main.cs           -> 物品动画帧数
 *                  TR_SRC / Terraria.Initializers/AssetInitializer.cs -> 贴图回退
 *   2. 官方本地化   TR_SRC / Terraria.Localization.Content.{zh-Hans,en-US}.Items.json
 *   3. 已解包贴图   SPRITE_DIR / Item_<id>.png          -> 图标是否存在 / 尺寸
 *   4. TShock 源码  TSHOCK_SRC / TShockAPI/Commands.cs  -> 核心指令（best-effort）
 *                  TShockAPI/Permissions.cs            -> 权限常量 → 字符串
 *
 * 运行：node tools/gen-data.mjs
 * 可用环境变量覆盖默认路径（见下方 CONFIG）。
 *
 * 注意：物品 ID/名称/贴图均对应 Terraria 1.4.5.8。版本不符时必须重新生成并报警。
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');

// 默认取「与本仓库同级」的目录（可用 env 覆盖），避免把某台机器的绝对路径写死。
const CONFIG = {
  trSrc: process.env.TR_SRC || join(PROJECT, '..', 'tr-code-1458'),
  spriteDir: process.env.SPRITE_DIR || join(PROJECT, '..', 'tr-sprite-1458', 'Content', 'Images'),
  tshockSrc: process.env.TSHOCK_SRC || join(PROJECT, '..', 'TShock'),
  outDir: process.env.OUT_DIR || join(PROJECT, 'data'),
};

// 写进 meta 的来源路径尽量用「相对仓库」形式，保持数据可移植。
const rel = (p) => relative(PROJECT, p) || p;

const read = (p) => readFileSync(p, 'utf8');
// 官方本地化 JSON 里存在尾逗号，不是严格 JSON，这里先清理
const parseJsonLoose = (p) => JSON.parse(read(p).replace(/,(\s*[}\]])/g, '$1'));

// ── PNG 尺寸（读 IHDR，不解码像素）──────────────────────────────────
function pngSize(path) {
  const b = readFileSync(path);
  // 8 字节签名 + 4 长度 + 4 "IHDR" -> 宽高各 4 字节 big-endian
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// ── C# 源码解析工具 ────────────────────────────────────────────────
const TOP_COMMA = (s) => {
  const out = []; let depth = 0, q = false, cur = '';
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && (ch === '(' || ch === '[' || ch === '{')) depth++;
    if (!q && (ch === ')' || ch === ']' || ch === '}')) depth--;
    if (!q && ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

function balanced(text, openIdx, open = '(', close = ')') {
  let depth = 0, q = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') q = !q;
    if (q) continue;
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// `public const <type> Name = <n>;` -> Map(id -> 第一个名字)
function parseConstMap(text, typeRe = 'short') {
  const map = new Map();
  const re = new RegExp(`public const ${typeRe} (\\w+) = (-?\\d+);`, 'g');
  for (const m of text.matchAll(re)) {
    const id = Number(m[2]);
    if (id <= 0 || m[1].startsWith('None') || m[1] === 'Count') continue;
    if (!map.has(id)) map.set(id, m[1]);
  }
  return map;
}

// `public static readonly string name = "perm";` -> Map(name -> perm)
function parsePermMap(text) {
  const map = new Map();
  for (const m of text.matchAll(/public static readonly string (\w+) = "([^"]+)";/g)) map.set(m[1], m[2]);
  return map;
}

/**
 * 解析 TShock `SpawnBoss()` 的 switch（Commands.cs）。
 * 返回 { byId, allIds }：
 *   - byId:  npcId -> 该 NPC 可用的 /sb 参数别名（如 eye / eye of cthulhu / eoc）
 *   - allIds: /sb all（或 *）一次生成的 Boss id 集合
 * 这是 NPC 图鉴右栏展示「召唤指令」的事实来源；/sb 的合法参数以服务器实际版本为准。
 */
function parseSpawnBoss(text) {
  const start = text.indexOf('private static void SpawnBoss(');
  const end = text.indexOf('private static void SpawnMob(', start);
  if (start < 0) return { byId: new Map(), allIds: new Set() };
  const body = text.slice(start, end < 0 ? undefined : end);
  const byId = new Map();
  const allIds = new Set();
  const parts = [...body.matchAll(/case\s+"([^"]+)"\s*:/g)];
  let run = [];
  for (let i = 0; i < parts.length; i++) {
    const label = parts[i][1];
    const segEnd = i + 1 < parts.length ? parts[i + 1].index : body.length;
    const seg = body.slice(parts[i].index + parts[i][0].length, segEnd);
    run.push(label);
    const hasAction = /SetDefaults|SpawnWOF|int\[\]/.test(seg);
    if (!hasAction) continue;
    // run = 这一组连续的 case 标签；seg = 该组的动作代码。
    const isAll = run.includes('*') || run.includes('all');
    if (isAll) {
      const arr = seg.match(/int\[\]\s+\w+\s*=\s*\{([^}]*)\}/);
      if (arr) for (const n of arr[1].split(',')) { const v = Number(n.trim()); if (v) allIds.add(v); }
    } else {
      const ids = [...seg.matchAll(/npc\.SetDefaults\((\d+)\)/g)].map((m) => Number(m[1]));
      if (ids.length === 0 && /NPC\.SpawnWOF/.test(seg)) ids.push(113); // Wall of Flesh 走 SpawnWOF
      for (const id of ids) {
        const list = byId.get(id) ?? [];
        for (const l of run) if (!list.includes(l)) list.push(l);
        byId.set(id, list);
      }
    }
    run = [];
  }
  return { byId, allIds };
}

// gettext .po 解析：msgid -> msgstr（支持多行/转义，忽略 fuzzy 条目）
function parsePoString(s) {
  const m = s.match(/^"((?:[^"\\]|\\.)*)"/);
  if (!m) return '';
  return m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parsePo(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  let id = null, str = null, mode = null, fuzzy = false;
  const flush = () => {
    if (id && !fuzzy && str != null) map.set(id, str);
    id = null; str = null; mode = null; fuzzy = false;
  };
  for (const line of read(path).split(/\r?\n/)) {
    if (line.startsWith('#,')) { if (line.includes('fuzzy')) fuzzy = true; continue; }
    if (line.startsWith('#')) continue;
    if (line.startsWith('msgid ')) { if (id !== null) flush(); id = parsePoString(line.slice(6)); mode = 'id'; continue; }
    if (line.startsWith('msgstr ')) { str = parsePoString(line.slice(7)); mode = 'str'; continue; }
    if (line.startsWith('"')) {
      const s = parsePoString(line);
      if (mode === 'id') id += s;
      else if (mode === 'str') str = (str ?? '') + s;
      continue;
    }
    if (line.trim() === '' && id !== null) flush();
  }
  if (id !== null) flush();
  return map;
}

// Factory.CreateBoolSet(...) -> Map(setName -> Set<number>)
function parseBoolSets(text) {
  const sets = new Map();
  for (const m of text.matchAll(/public static bool\[\] (\w+) = Factory\.CreateBoolSet\(([^;]*)\);/g)) {
    const ids = new Set((m[2].match(/\d+/g) || []).map(Number));
    ids.delete(0);
    sets.set(m[1], ids);
  }
  return sets;
}

// TextureCopyLoad 是 CreateIntSet(-1, id, target, id, target, ...)
function parseTextureCopy(text) {
  const m = text.match(/TextureCopyLoad = Factory\.CreateIntSet\(([^;]*)\);/);
  const copy = new Map();
  if (!m) return copy;
  const nums = (m[1].match(/-?\d+/g) || []).map(Number);
  for (let i = 1; i + 1 < nums.length; i += 2) copy.set(nums[i], nums[i + 1]);
  return copy;
}

// Main.InitializeItemAnimations -> Map(itemId -> frameCount)
function parseItemFrames(text) {
  const frames = new Map();
  for (const m of text.matchAll(/RegisterItemAnimation\((\d+), new DrawAnimationVertical\(\s*\d+,\s*(\d+)/g)) {
    frames.set(Number(m[1]), Number(m[2]));
  }
  const orb = text.match(/RegisterItemAnimation\((\d+), new DrawAnimationScryingOrb[\s\S]*?FrameCount = (\d+)/);
  if (orb) frames.set(Number(orb[1]), Number(orb[2]));
  return frames;
}

// 指令：new Command(...) { ... }（best-effort，来源为源码，运行时仍需校验）
// ── 指令参数（best-effort，来源全部可在 TShockAPI/Commands.cs 中核对）──────
//
// TShock 的 Command 对象**没有**结构化参数元数据（只有 HelpText / HelpDesc），
// 所以参数信息只能从源码里三处可信来源提取：
//   1. TShock 自己打印的用法串：GetString("Invalid syntax. Proper syntax: {0}<cmd> <args>")
//   2. 源码里的枚举常量：_validEvents / _validInvasions / _worldModes
//   3. 方法体里完全不引用 args.Parameters → 该指令不需要参数（机械判定）
// 少数有参数但没写用法串的命令，用下面的 PARAM_OVERRIDES 手写（每条标注源码行）。
// 提取不到的指令一律**不给** paramSets，前端退回自由输入，绝不瞎猜参数。
const PARAM_OVERRIDES = {
  // 源码写法：参数顺序/必填性已按 getter 实现逐行核对。
  Time: { syntax: 'time <day|night|noon|midnight|hh:mm>', source: 'Commands.cs:4626 Time()',
    args: [{ name: 'time', required: true, kind: 'enum', values: ['day', 'night', 'noon', 'midnight'] }] },
  Clear: { syntax: 'clear <item|npc|projectile> [radius]', source: 'Commands.cs:5984 Clear()',
    args: [{ name: 'item|npc|projectile', required: true, kind: 'enum', values: ['item', 'npc', 'projectile'] },
           { name: 'radius', required: false, kind: 'number' }] },
  Mute: { syntax: 'mute <player> [reason]', source: 'Commands.cs:5571 Mute()',
    args: [{ name: 'player', required: true, kind: 'player' },
           { name: 'reason', required: false, kind: 'text' }] },
  Butcher: { syntax: 'butcher [NPC name|ID]', source: 'Commands.cs:6183 Butcher()',
    args: [{ name: 'NPC name|ID', required: false, kind: 'text' }] },
  Heal: { syntax: 'heal <player> [amount]', source: 'Commands.cs:6487 注释 // heal <player> [amount]',
    args: [{ name: 'player', required: true, kind: 'player' },
           { name: 'amount', required: false, kind: 'number' }] },
  GBuff: { syntax: 'gbuff <player> <buff> [duration]', source: 'Commands.cs:6597 GBuff()',
    args: [{ name: 'player', required: true, kind: 'player' },
           { name: 'buff', required: true, kind: 'text' },
           { name: 'duration', required: false, kind: 'number' }] },
  FireWork: { syntax: 'firework <player> [R|G|B|Y]', source: 'Commands.cs:5796 注释 // firework <player> [R|G|B|Y]',
    args: [{ name: 'player', required: true, kind: 'player' },
           { name: 'color', required: false, kind: 'enum', values: ['R', 'G', 'B', 'Y'] }] },
  Broadcast: { syntax: 'broadcast <message>', source: 'Commands.cs:2074 Broadcast()',
    args: [{ name: 'message', required: true, kind: 'text', variadic: true }] },
  Buff: { syntax: 'buff <buff name|ID> [duration]', source: 'Commands.cs:6546 Buff()',
    args: [{ name: 'buff', required: true, kind: 'buff' },
           { name: 'duration', required: false, kind: 'number' }] },
};

// 取出 TShockAPI/Commands.cs 里每个 static 方法的方法体（括号配平）。
function extractMethodBodies(text) {
  const out = new Map();
  const re = /\n\t\t(?:private |public |internal )?static (?:void|bool) (\w+)\(/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index);
    if (open < 0) continue;
    const close = balanced(text, open, '{', '}');
    if (close < 0) continue;
    if (!out.has(m[1])) out.set(m[1], text.slice(open + 1, close));
    re.lastIndex = close;
  }
  return out;
}

// 从方法体里取出所有 "Proper syntax: {0}<cmd> <args>" 用法串。
function extractSyntaxStrings(body) {
  const out = [];
  const re = /Proper syntax: \{0\}([^"]*)/g;
  for (const m of body.matchAll(re)) {
    let t = m[1].trim();
    if (t.endsWith('.')) t = t.slice(0, -1);
    if (t.endsWith('\\')) t = t.slice(0, -1);
    t = t.trim();
    if (t) out.push(t);
  }
  return out;
}

// 取源码里的 List<string> 字面量 / Dictionary 键，用于枚举取值。
function extractStringLiterals(text, nameRe) {
  const m = text.match(new RegExp(nameRe + '[^{]*\\{([\\s\\S]*?)\\n\\t\\t\\}'));
  if (!m) return [];
  const vals = [];
  for (const s of m[1].matchAll(/"([^"]+)"/g)) vals.push(s[1]);
  return vals;
}

// 参数名 → 补全来源。**只声明确实有数据源的类型**，其余一律 text/number（只做提示，不给候选）：
//   player  → /api/players 在线玩家名
//   item    → data/items.json（ID / 中文名 / 英文名 / 内部名）
//   prefix  → data/prefixes.json
//   npc     → data/npcs.json（离线）
//   buff    → data/buffs.json（离线）
//   region  → TShock 运行时（伴生插件 /api/data）
//   warp    → TShock 运行时（伴生插件 /api/data）
//   enum    → 自带 values（来源：源码 switch case、枚举常量或字面量）
//   command → data/commands.json 的指令名 + 别名
//   number / text → 无候选，仅用于界面提示「第几个参数、必填与否」
// 表里没有、也推不出数据源的参数名（如 group 名）保持 text，不去猜。
const ENUM = (...values) => ({ kind: 'enum', values });
const PARAM_KINDS = {
  player: 'player',
  'player 2': 'player',
  'player|*': 'player',
  username: 'player',
  'prefix id/name': 'prefix',
  'item name': 'item',
  'item name/id': 'item',
  'item type/id': 'item',
  'command or alias': 'command',
  'command/page': 'command',
  amount: 'number',
  damage: 'number',
  radius: 'number',
  page: 'number',
  '#': 'number',
  'tile x': 'number',
  'tile y': 'number',
  'speed in mph': 'number',
  duration: 'number',
  'proj id': 'number',
  'tile id': 'number',
  id: 'number',
  'item amount': 'number',
  'true/false': ENUM('true', 'false'),
  'u/d/l/r': ENUM('u', 'd', 'l', 'r'),
  'item|npc|projectile': ENUM('item', 'npc', 'projectile'),
  '-d': ENUM('-d'),
};

// 同名字面量用 `/` 分隔（如 `<true/false>`、`<u/d/l/r>`）时按枚举处理；
// `command/page` 里的 command 不是取值而是「指令名或页码」，仍按 command 补全。
function inferKind(name, altValues) {
  const known = PARAM_KINDS[name];
  if (known) return typeof known === 'string' ? { kind: known } : { ...known };
  if (altValues) {
    if (altValues.length === 2 && altValues[0].toLowerCase() === 'player' && altValues[1] === '*') {
      return { kind: 'player' };
    }
    return { kind: 'enum', values: altValues };
  }
  const slash = name.split('/');
  if (slash.length > 1 && slash.every((x) => /^[\w*-]+$/.test(x))) {
    if (slash.includes('command')) return { kind: 'command' };
    return { kind: 'enum', values: slash };
  }
  return { kind: 'text' };
}

// 同名参数在不同子命令里含义不同时的语义修正（已按源码逐个核对）。
// 键：`方法名|子命令字面量`；值：非字面量参数下标 → kind。
const PARAM_FIXES = {
  // Commands.cs:4877 case "allow" / 4913 case "remove"：Parameters[1] 是账号名 → 按玩家名补全
  'Region|allow': { 0: 'player' },
  'Region|remove': { 0: 'player' },
};

// 从 `switch (args.Parameters[N].ToLower())` 的 case 标签里取枚举取值
// （例：/spawnboss 的 BOSS 名、/clear 的对象、/time 的时间）。
function extractSwitchEnums(body) {
  const out = new Map(); // 参数下标 -> values
  const re = /switch \(args\.Parameters\[(\d+)\]\.ToLower(?:Invariant)?\(\)\)\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    const open = body.indexOf('{', m.index);
    const close = balanced(body, open, '{', '}');
    if (close < 0) break;
    const seg = body.slice(open + 1, close);
    const vals = [];
    for (const c of seg.matchAll(/case "([^"]+)":/g)) vals.push(c[1]);
    if (vals.length > 1) out.set(Number(m[1]), [...new Set(vals)]);
    re.lastIndex = close;
  }
  return out;
}

// 用法串分词：`<...>` / `[...]` 内部可以含空格（如 `<item type/id>`、`[new parent group name]`），
// 必须整体作为一个 token，否则参数名会被拆坏。
function tokenizeSyntax(syntax) {
  const out = [];
  let i = 0;
  while (i < syntax.length) {
    const ch = syntax[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '<' || ch === '[') {
      const close = ch === '<' ? '>' : ']';
      const j = syntax.indexOf(close, i);
      if (j > i) { out.push(syntax.slice(i, j + 1)); i = j + 1; continue; }
    }
    let j = i;
    while (j < syntax.length && !/[\s<[]/.test(syntax[j])) j++;
    out.push(syntax.slice(i, j));
    i = j;
  }
  return out;
}

// 把 "<cmd> <a> [b] [c...]" 解析成参数表；首个 token（命令本身）与字面子命令都保留为 literal。
function parseSyntaxArgs(syntax, cmdName) {
  const tokens = tokenizeSyntax(syntax);
  const args = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (i === 0 && tok.toLowerCase() === cmdName.toLowerCase()) continue; // 命令名本身
    if (tok === '{0}') continue; // 资源串前缀占位
    let required = true, core = tok;
    if (/^\[.*\]$/.test(tok)) { required = false; core = tok.slice(1, -1); }
    else if (/^<.*>$/.test(tok)) { core = tok.slice(1, -1); }
    else {
      // 字面子命令（如 group addperm …）：作为 literal 参与位置对齐
      args.push({ literal: core });
      continue;
    }
    const variadic = /\.\.\.$/.test(core);
    if (variadic) core = core.replace(/\.\.\.$/, '');
    let altValues = null;
    if (core.includes('|')) {
      const parts = core.split('|').map((x) => x.trim());
      if (parts.every((x) => /^[\w*]+$/.test(x))) altValues = parts;
    }
    const { kind, values } = inferKind(core, altValues);
    const arg = { name: core, required, kind };
    if (variadic) arg.variadic = true;
    if (values) arg.values = values;
    args.push(arg);
  }
  return args;
}

// 汇总每个 handler 方法的参数集（可能多套，例如 /group 的多个子命令）。
function buildParamSets(bodies, methodNames, cmdNameOf) {
  const sets = new Map(); // handler -> [{syntax, args}]
  for (const method of methodNames) {
    const body = bodies.get(method);
    if (body == null) continue;
    const cmdName = cmdNameOf(method) || method.toLowerCase();
    const out = [];
    for (const raw of extractSyntaxStrings(body)) {
      const syn = raw.replace(/\s+/g, ' ').trim();
      // 含 {0} 的是「多变体说明」而非单一用法（如 `warp [name] or {0}warp list <page>`），跳过
      if (syn.includes('{0}')) continue;
      // 同一方法的重复用法串去重
      if (out.some((s) => s.syntax === syn)) continue;
      out.push({ syntax: syn, args: parseSyntaxArgs(syn, cmdName) });
    }
    const ov = PARAM_OVERRIDES[method];
    if (ov) {
      if (!out.some((s) => s.syntax === ov.syntax)) out.push({ syntax: ov.syntax, args: ov.args, source: ov.source });
    } else if (out.length === 0 && !/\bargs\.Parameters\b/.test(body)) {
      // 机械判定：方法体完全不引用 args.Parameters → 不需要参数
      out.push({ syntax: cmdName, args: [] });
    }
    // 源码 switch 的 case 标签 → 该位置参数的枚举取值（不覆盖已确定的 player/item/prefix/command）
    const switchEnums = extractSwitchEnums(body);
    if (switchEnums.size) {
      for (const set of out) {
        let valueIdx = -1;
        for (const a of set.args) {
          if (a.literal) continue;
          valueIdx++;
          const vals = switchEnums.get(valueIdx);
          if (!vals) continue;
          if (a.kind !== 'text' && a.kind !== 'number') continue; // 已有明确类型（含手写枚举）不覆盖
          a.kind = 'enum';
          a.values = vals;
        }
      }
    }
    for (const set of out) {
      const literal = (set.args.find((a) => a.literal) || {}).literal;
      const fix = PARAM_FIXES[`${method}|${literal}`];
      if (!fix) continue;
      let valueIdx = -1;
      for (const a of set.args) {
        if (a.literal) continue;
        valueIdx++;
        const kind = fix[valueIdx];
        if (kind) {
          a.kind = kind;
          delete a.values;
        }
      }
    }
    if (out.length) sets.set(method, out);
  }
  return sets;
}

function parseCommands(text, permMap) {
  const cmds = [];
  const re = /new Command\(/g;
  let m;
  while ((m = re.exec(text))) {
    const close = balanced(text, m.index + 'new Command'.length);
    if (close < 0) continue;
    const args = TOP_COMMA(text.slice(m.index + 'new Command('.length, close));
    let permission = null, rest = args;
    const first = args[0];
    if (/^Permissions\.\w+$/.test(first)) {
      permission = permMap.get(first.slice('Permissions.'.length)) || null;
      rest = args.slice(1);
    } else if (/^null$/.test(first)) {
      rest = args.slice(1);
    } else if (/^"[^"]*"$/.test(first)) {
      permission = first.slice(1, -1);
      rest = args.slice(1);
    } // 否则第一个是方法名（无权限）
    const names = rest.map((a) => a.match(/^"([^"]*)"$/)).filter(Boolean).map((x) => x[1]);
    // 处理函数名（如 `new Command(Permissions.give, Give, "give", "g")` 里的 Give）
    const handler = rest.find((a) => /^[A-Za-z_]\w*$/.test(a)) || null;
    // 初始化块
    let body = '';
    let i = close + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '{') body = text.slice(i + 1, balanced(text, i, '{', '}'));
    const help = (body.match(/HelpText\s*=\s*GetString\("((?:[^"\\]|\\.)*)"\)/) ||
      body.match(/HelpText\s*=\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || null;
    const flag = (name) => {
      const mm = body.match(new RegExp(name + '\\s*=\\s*(true|false)'));
      return mm ? mm[1] === 'true' : null;
    };
    cmds.push({
      name: names[0] || null,
      aliases: names.slice(1),
      handler,
      permission,
      help,
      // 默认值参考 TShockAPI/Commands.cs：AllowServer / DoLog 默认均为 true
      allowServer: flag('AllowServer') !== false,
      doLog: flag('DoLog') !== false,
    });
    re.lastIndex = close;
  }
  return cmds.filter((c) => c.name);
}

const TAG_LABELS = {
  IsFood: '食物', IsQuestFish: '任务鱼', IsFishingCrate: '宝匣', IsFishingCrateHardmode: '困难模式宝匣',
  IsBasicFish: '鱼', IsLavaBait: '岩浆鱼饵', IsAMaterial: '材料', IsCrafted: '合成品',
  IsDrill: '钻头', IsChainsaw: '电锯', IsPaintScraper: '涂料刮刀', IsAVoiceChangeItem: '语音变换',
  Yoyo: '悠悠球', BossBag: '宝藏袋', OpenableBag: '可开启袋', Torches: '火把', WaterTorches: '水火炬',
  Campfires: '营火', Glowsticks: '荧光棒', GrassSeeds: '草种子', Moss: '苔藓', Deprecated: '已废弃',
  ItemsThatShouldNotBeInInventory: '不可入背包', CanGetPrefixes: '可附魔', IsAKite: '风筝',
  IsWireableStatue: '可接线雕像',
};

function main() {
  const { trSrc, spriteDir, tshockSrc, outDir } = CONFIG;
  mkdirSync(outDir, { recursive: true });

  // ── 1. 物品 ID → 内部名 ────────────────────────────────────────
  const itemIdSrc = read(join(trSrc, 'Terraria.ID/ItemID.cs'));
  const id2key = parseConstMap(itemIdSrc);
  const textureCopy = parseTextureCopy(itemIdSrc);
  const boolSets = parseBoolSets(itemIdSrc);

  // ── 2. 官方本地化（按语言拆分为 loc.<culture>.json）─────────────
  // 只保留前端运行期真正用到的分类：物品名 / 词缀名 / 配方组名。
  // 值逐字取自官方 JSON，不做任何改写；文件保持游戏原生的两级 {分类:{key:值}} 格式。
  const LOC_CATEGORIES = ['ItemName', 'Prefix', 'Misc', 'LegacyMisc', 'NPCName', 'BuffName'];
  const loadLocBundle = (culture) => {
    const files = [
      `Terraria.Localization.Content.${culture}.Items.json`,
      `Terraria.Localization.Content.${culture}.Legacy.json`,
      `Terraria.Localization.Content.${culture}.json`,
      `Terraria.Localization.Content.${culture}.NPCs.json`,
      `Terraria.Localization.Content.${culture}.Game.json`,
    ];
    const merged = {};
    for (const f of files) {
      const p = join(trSrc, f);
      if (!existsSync(p)) continue;
      const data = parseJsonLoose(p);
      for (const cat of LOC_CATEGORIES) {
        if (data[cat]) Object.assign((merged[cat] ||= {}), data[cat]);
      }
    }
    return merged;
  };
  const locZh = loadLocBundle('zh-Hans');
  const locEn = loadLocBundle('en-US');

  // ── 3. 动画帧数 ────────────────────────────────────────────────
  const frames = parseItemFrames(read(join(trSrc, 'Terraria/Main.cs')));
  for (const id of boolSets.get('IsFood') || []) if (!frames.has(id)) frames.set(id, 3);

  // ── 4. 贴图尺寸 & 图标回退链 ───────────────────────────────────
  const sprites = new Map();
  for (const f of readdirSync(spriteDir)) {
    const mm = f.match(/^Item_(\d+)\.png$/);
    if (mm) sprites.set(Number(mm[1]), pngSize(join(spriteDir, f)));
  }
  const resolveIcon = (id) => {
    let cur = id, guard = 0;
    while (!sprites.has(cur) && textureCopy.has(cur) && guard++ < 10) cur = textureCopy.get(cur);
    return sprites.has(cur) ? cur : null;
  };

  // ── 5. 组装物品 ────────────────────────────────────────────────
  const tagIndex = new Map();
  for (const [setName, label] of Object.entries(TAG_LABELS)) {
    const set = boolSets.get(setName);
    if (!set) continue;
    for (const id of set) {
      if (!tagIndex.has(id)) tagIndex.set(id, []);
      tagIndex.get(id).push(label);
    }
  }

  const items = [];
  for (const id of [...id2key.keys()].sort((a, b) => a - b)) {
    const key = id2key.get(id);
    const iconId = resolveIcon(id);
    const size = iconId != null ? sprites.get(iconId) : null;
    items.push({
      id,
      key,
      icon: iconId,
      frames: frames.get(id) ?? frames.get(iconId) ?? 1,
      sprite: size, // [w,h]，前端据此裁剪第一帧
      tags: tagIndex.get(id) || [],
    });
  }

  // ── 6. 词缀 ────────────────────────────────────────────────────
  const prefixIdSrc = read(join(trSrc, 'Terraria.ID/PrefixID.cs'));
  const prefixId2key = parseConstMap(prefixIdSrc, '(?:int|byte|short)');
  // NPC / buff（ID → 内部名；名字在运行期从 loc.NPCName / loc.BuffName 解析）
  // 与物品同一套做法：NPCID/BuffID 常量名就是官方本地化的 key。
  // 只取正数 ID（NPCID 里负数的是网络 ID，parseConstMap 已舍弃）。
  const npcId2key = parseConstMap(read(join(trSrc, 'Terraria.ID/NPCID.cs')), 'short');
  // /sb (spawnboss) 的合法参数：从 TShock SpawnBoss() 的 switch 解析（用于 NPC 图鉴右栏）。
  const { byId: sbById, allIds: sbAllIds } = parseSpawnBoss(read(join(tshockSrc, 'TShockAPI/Commands.cs')));
  // 英文名一并写入：`/tpnpc` 只认**名字**（不认 ID），且 TShock 会同时匹配英文名，
  // 用英文名生成的指令在中文 / 英文服务器上都有效（见 docs/页面-召唤NPC.md）。
  const enNpcName = locEn.NPCName ?? {};
  const npcs = [...npcId2key.keys()].sort((a, b) => a - b).map((id) => {
    const key = npcId2key.get(id);
    const entry = { id, key, en: enNpcName[key] ?? key };
    const aliases = sbById.get(id);
    if (aliases && aliases.length) {
      // 取最长别名作为展示用的规范写法（如 "eye of cthulhu"），完整别名留在 sbAliases。
      entry.sb = aliases.slice().sort((a, b) => b.length - a.length)[0];
      if (aliases.length > 1) entry.sbAliases = aliases.slice().sort();
    }
    if (sbAllIds.has(id)) entry.sbAll = true;
    return entry;
  });
  const buffId2key = parseConstMap(read(join(trSrc, 'Terraria.ID/BuffID.cs')), 'int');
  const buffs = [...buffId2key.keys()].sort((a, b) => a - b).map((id) => ({ id, key: buffId2key.get(id) }));
  const prefixes = [...prefixId2key.keys()].sort((a, b) => a - b).map((id) => ({
    id,
    key: prefixId2key.get(id),
  }));

  // ── 7. 指令 ────────────────────────────────────────────────────
  const permsSrc = read(join(tshockSrc, 'TShockAPI/Permissions.cs'));
  const restPermsSrc = existsSync(join(tshockSrc, 'TShockAPI/Rest/RestPermissions.cs'))
    ? read(join(tshockSrc, 'TShockAPI/Rest/RestPermissions.cs')) : '';
  const permMap = new Map([...parsePermMap(permsSrc), ...parsePermMap(restPermsSrc)]);
  const zhDict = parsePo(join(tshockSrc, 'i18n/zh_CN/TShockAPI.po'));
  const commandsSrc = read(join(tshockSrc, 'TShockAPI/Commands.cs'));
  const commands = parseCommands(commandsSrc, permMap).map((c) => ({
    ...c,
    // help 为英文原文（GetString 的 msgid）；helpZh 取自 TShock i18n/zh_CN。
    helpEn: c.help,
    helpZh: c.help ? zhDict.get(c.help) ?? null : null,
  }));

  // ── 7b. 指令参数（best-effort，见本文件顶部 buildParamSets 的说明）──
  const bodies = extractMethodBodies(commandsSrc);
  const methodNames = [...new Set(commands.map((c) => c.handler).filter(Boolean))];
  const cmdNameOf = (method) => (commands.find((c) => c.handler === method) || {}).name;
  const paramSets = buildParamSets(bodies, methodNames, cmdNameOf);
  // 源码里的枚举常量 → 对应参数取值
  const enumExtras = {
    ManageWorldEvent: extractStringLiterals(commandsSrc, '_validEvents')
      .concat(extractStringLiterals(commandsSrc, '_validInvasions')),
    ChangeWorldMode: extractStringLiterals(commandsSrc, '_worldModes'),
  };
  let paramCommandCount = 0;
  for (const c of commands) {
    const handler = c.handler;
    // 源码枚举常量（如 /worldevent 的事件名、/worldmode 的模式名）补到同名参数上。
    const vals = handler && enumExtras[handler] ? [...new Set(enumExtras[handler])] : null;
    if (vals && vals.length && paramSets.has(handler)) {
      for (const set of paramSets.get(handler)) {
        for (const a of set.args) {
          if (a.literal || a.kind === 'player' || a.kind === 'item' || a.kind === 'prefix') continue;
          a.kind = 'enum';
          a.values = vals;
        }
      }
    }
    delete c.handler;
    const sets = paramSets.get(handler);
    if (sets) {
      c.paramSets = sets;
      paramCommandCount++;
    }
  }

  // 运行期补全类型：参数名 → kind。
  //   npc / buff 的候选来自下面生成的 npcs.json / buffs.json（离线）；
  //   region / warp 的候选来自 TShock 运行时（伴生插件 /api/data），前端运行时注入。
  // 只改写从用法串析出、名字可无歧义对应到数据源的参数；不改其它 text/number。
  const RUNTIME_KIND_BY_ARG = {
    'NPC name|ID': 'npc',
    NPC: 'npc',
    'mob type': 'npc',
    buff: 'buff',
    region: 'region',
    warpname: 'warp',
  };
  for (const c of commands) {
    for (const set of c.paramSets || []) {
      for (const a of set.args) {
        const kind = RUNTIME_KIND_BY_ARG[a.name];
        if (kind && a.kind === 'text') a.kind = kind;
      }
    }
  }
  // /warp <warpname>：base 集的「[command] [arguments]」首参既是子命令又是传送点名，
  // 补一个只含传送点名的形态，让 `/warp <Tab>` 能出候选（子命令仍由 add/del/... 的字面量集处理）。
  const warpCmd = commands.find((c) => c.name === 'warp');
  if (warpCmd && warpCmd.paramSets) {
    warpCmd.paramSets = [
      { syntax: 'warp <warpname>', args: [{ name: 'warpname', required: false, kind: 'warp' }] },
      ...warpCmd.paramSets,
    ];
  }

  // ── 8. 版本读取 ────────────────────────────────────────────────
  const asm = read(join(trSrc, 'Properties/AssemblyInfo.cs'));
  const gameVersion = (asm.match(/AssemblyFileVersion\("([^"]+)"\)/) || [])[1] || 'unknown';
  const tshockCsproj = read(join(tshockSrc, 'TShockAPI/TShockAPI.csproj'));
  const tshockVersion = (tshockCsproj.match(/<Version>([^<]+)<\/Version>/) || [])[1] || 'unknown';

  // ── 9. 写文件 ──────────────────────────────────────────────────
  const writeJson = (name, obj) => {
    const p = join(outDir, name);
    writeFileSync(p, JSON.stringify(obj, null, 1) + '\n', 'utf8');
    console.log(`  写出 ${name}  (${(JSON.stringify(obj).length / 1024).toFixed(0)} KB)`);
  };
  const writeJsonCompact = (name, obj) => {
    const p = join(outDir, name);
    writeFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
    console.log(`  写出 ${name}  (${(JSON.stringify(obj).length / 1024).toFixed(0)} KB)`);
  };

  writeJson('items.json', {
    meta: { gameVersion, locales: ['zh-Hans', 'en-US'], count: items.length, spriteDir: rel(spriteDir) },
    items,
  });
  writeJson('prefixes.json', {
    meta: { gameVersion, count: prefixes.length },
    prefixes,
  });
  writeJson('npcs.json', {
    meta: {
      gameVersion,
      count: npcs.length,
      source: 'Terraria.ID/NPCID.cs + loc.NPCName + loc.en-US + TShockAPI/Commands.cs SpawnBoss()',
    },
    npcs,
  });
  writeJson('buffs.json', {
    meta: { gameVersion, count: buffs.length, source: 'Terraria.ID/BuffID.cs + loc.BuffName' },
    buffs,
  });
  // 语言文件：保持游戏官方的 {分类:{key:值}} 格式，紧凑写出（体积敏感）。
  writeJsonCompact('loc.zh-Hans.json', locZh);
  writeJsonCompact('loc.en-US.json', locEn);
  writeJson('commands.json', {
    meta: {
      source: 'TShockAPI/Commands.cs (核心指令, best-effort 解析) + i18n/zh_CN/TShockAPI.po',
      tshockVersion,
      note: '插件指令和运行时别名不在此文件中，实际可用指令以目标服务器为准',
      paramNote: 'paramSets 为 best-effort：仅来自 TShock 源码里可信的用法串/枚举常量或方法体不引用 args.Parameters 的机械判定；没有 paramSets 的指令请自由输入',
      count: commands.length,
      paramCount: paramCommandCount,
    },
    commands,
  });
  writeJson('meta.json', {
    gameVersion,
    tshockVersion,
    itemCount: items.length,
    prefixCount: prefixes.length,
    npcCount: npcs.length,
    buffCount: buffs.length,
    commandCount: commands.length,
    spriteCount: sprites.size,
    textureCopyCount: textureCopy.size,
    generatedBy: 'tools/gen-data.mjs',
    sources: { trSrc: rel(trSrc), spriteDir: rel(spriteDir), tshockSrc: rel(tshockSrc) },
  });

  console.log(`\n完成：${items.length} 物品 / ${prefixes.length} 词缀 / ${npcs.length} NPC / ${buffs.length} buff / ${commands.length} 指令（其中 ${paramCommandCount} 条带参数表）`);
  const noIcon = items.filter((i) => i.icon == null).length;
  if (noIcon) console.warn(`警告：${noIcon} 个物品没有解析到图标`);
}

main();
