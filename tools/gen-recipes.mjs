#!/usr/bin/env node
/**
 * gen-recipes.mjs —— 把 GameDump 导出的原始数据整理为前端可用的 data/recipes.json。
 * 输入：TR_SRC（反编译源码，用于还原配方组 key） + recipes-raw.json
 * 输出：data/recipes.json（纯 id / key，无任何语言字段）
 * 由 tools/gen-game-data.sh 调用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458');
const RAW = process.env.RAW || '/tmp/recipes-raw.json';
const OUT = process.env.OUT || join(HERE, '..', 'data', 'recipes.json');

const raw = JSON.parse(readFileSync(RAW, 'utf8'));

// 配方组只保留本地化 key，名称由前端按当前语言从 loc.<culture>.json 解析。
// GameDump 把 `Lang.GetNPCNameValue(616)` 记为 "NPCName(616)"，这里还原成
// `NPCName.<内部名>`（Turtle），否则前端无法查表。
const npcId2key = new Map();
try {
  const src = readFileSync(join(TR_SRC, 'Terraria.ID/NPCID.cs'), 'utf8');
  for (const m of src.matchAll(/public const short (\w+) = (\d+);/g)) npcId2key.set(Number(m[2]), m[1]);
} catch { /* 缺源码时保留原样 */ }
const normalizeGroupKey = (key) => {
  const m = /^NPCName\((\d+)\)$/.exec(key);
  if (m) return 'NPCName.' + (npcId2key.get(Number(m[1])) ?? m[1]);
  return key;
};

const groups = {};
for (const g of raw.groups) {
  groups[g.Name] = { key: normalizeGroupKey(g.Key), items: g.Items };
}

const ENV = {
  needHoney: 'honey', needWater: 'water', needLava: 'lava', needSnow: 'snow',
  needGraveyard: 'graveyard', needTorchGodsFavor: 'torchGod', needMechdusa: 'mechdusa',
};
const FLAG = { crimson: 'crimson', corruption: 'corruption', notDecraftable: 'notDecraftable' };

const recipes = [];
for (const r of raw.recipes) {
  const env = [];
  for (const [k, v] of Object.entries(ENV)) if (r[k]) env.push(v);
  const flags = [];
  for (const [k, v] of Object.entries(FLAG)) if (r[k]) flags.push(v);
  recipes.push({
    result: { id: r.create.id, stack: r.create.stack },
    ingredients: r.req.map((q) => ({
      id: q.id,
      stack: q.stack,
      ...(q.group !== null ? { group: raw.groups[q.group].Name } : {}),
    })),
    station: r.tile,
    stationItems: r.stations,
    ...(env.length ? { env } : {}),
    ...(flags.length ? { flags } : {}),
    ...(r.shimmer.length ? { shimmer: r.shimmer.map((s) => ({ id: s.id, stack: s.stack })) } : {}),
  });
}

// 索引：result / ingredient（含配方组成员）→ 配方下标
const byResult = {};
const byIngredient = {};
recipes.forEach((r, i) => {
  (byResult[r.result.id] ||= []).push(i);
  for (const ing of r.ingredients) {
    const ids = ing.group ? groups[ing.group].items : [ing.id];
    for (const id of ids) (byIngredient[id] ||= []).push(i);
  }
});

const out = {
  meta: {
    gameVersion: raw.gameVersion,
    count: recipes.length,
    groupCount: Object.keys(groups).length,
    source: 'Terraria.Recipe.SetupRecipes() @ OTAPI ' + raw.gameVersion,
    generatedBy: 'tools/gen-recipes.mjs',
  },
  groups,
  recipes,
  byResult,
  byIngredient,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('recipes:', recipes.length, 'groups:', Object.keys(groups).length,
  'byResult items:', Object.keys(byResult).length, 'byIngredient items:', Object.keys(byIngredient).length);
console.log('sample group:', JSON.stringify(groups.Wood));
console.log('sample recipe:', JSON.stringify(recipes.find((r) => r.result.id === 22 && r.ingredients.length === 1 && r.station === 17)));
