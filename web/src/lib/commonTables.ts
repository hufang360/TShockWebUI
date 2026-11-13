import type { Lang } from '@/types'
import { MODIFIER_ROWS, type ModifierRow } from '@/lib/modifiers'

/**
 * 数据来源（抓取 2026-11-13）：
 * - 世界种子：Terraria Wiki Secret world seeds（zh 258113 / en 1035983）与 Special world seeds（zh 258217 / en 1035982）；
 * - 词缀：Modifiers（同一批修订）；
 * - 图标：`data/seed-icons/`（各表 info 框的 `File:Seed_<名>.png`，Zenith 为 `Seed_Everything.gif`；
 *   吸血鬼用 NPC 159 的贴图单独裁出）；
 * - `/wm` 指令：TShockWorldModify `WorldModify/Tools/WM/WMSecretSeedTool.cs` 的关键词。
 */

export interface LocalizedText {
  zh: string
  en: string
}

export interface CommonTableRow {
  /** 内部名称，同时作为行键。 */
  internal: string
  /** 可直接输入世界种子栏的代码（部分种子有多个等价写法）。 */
  codes: string[]
  name: LocalizedText
  desc: LocalizedText
  /** `data/` 下的图标文件名；没有图标的表不渲染图标。 */
  icon?: string
  /** 世界管理插件（WorldModify）的开关关键词：`/wm s <wm>`；非种子类不填。 */
  wm?: string
}

export interface CommonTableSection {
  id: string
  /** 没有分类的表省略它，表内就不出现分隔行。 */
  name?: LocalizedText
  rows: CommonTableRow[]
}

interface TableBase {
  id: string
  name: LocalizedText
  /** 表格对应的 wiki 页面，按界面语言取一条。 */
  wiki: LocalizedText
}

/** 按分类分组、每行是「名称 / 内部名称 / 代码 / 描述」的资料表。 */
export interface SeedTable extends TableBase {
  kind: 'seeds'
  /** 整张表统一的图标（行上没有 `icon` 时用它）。 */
  icon?: string
  sections: CommonTableSection[]
}

/** 按行列出数值的词缀表（列在页面里按 `MODIFIER_STATS` 渲染）。 */
export interface ModifierTable extends TableBase {
  kind: 'modifiers'
  rows: ModifierRow[]
}

export type CommonTable = SeedTable | ModifierTable

/** 世界种子：特殊种子在前，秘密种子按 wiki 的 7 个分类排。 */
const WORLD_SEEDS: SeedTable = {
  kind: 'seeds',
  id: 'worldSeeds',
  name: { zh: '世界种子', en: 'World seeds' },
  wiki: {
    zh: 'https://terraria.wiki.gg/zh/wiki/World_Seed',
    en: 'https://terraria.wiki.gg/wiki/World_Seed',
  },
  icon: 'seed-icons/WorldSeed.png',
  sections: [
    {
      id: 'special',
      name: { zh: '特殊世界种子', en: 'Special world seeds' },
      rows: [
        {
          internal: 'NotTheBees',
          codes: ['not the bees'],
          name: { zh: '蜜蜂之惧', en: 'Not the Bees' },
          desc: { zh: '进入一片弥漫着甜腻蜂香的大陆，在这里嗡嗡振翅声和有毒蛰刺的威胁潜伏在每一个角落！（防蜂头盔需自备）', en: 'Enter a land oozing with syrupy honey, where the buzzing of wings and the threat of venomous stingers awaits around every turn! (Wicker helmet not included)' },
          icon: 'seed-icons/NotTheBees.png',
          wm: 'ntb',
        },
        {
          internal: 'Drunk',
          codes: ['5162020'],
          name: { zh: '一醉方休', en: 'Drunk' },
          desc: { zh: '猩红加上腐化？二者一起出现？简直疯狂。在这片大陆上，世界生成过程已经彻底失控，带来了一场绝无仅有的泰拉瑞亚冒险！回家吧，世界生成过程，你喝醉了！', en: 'Crimson & Corruption? Together? Madness. This is the land of world generation gone wild, leading to a Terraria adventure like no other! Go home worldgen, you’re drunk!' },
          icon: 'seed-icons/Drunk.png',
          wm: '2020',
        },
        {
          internal: 'Celebration',
          codes: ['celebrationmk10', '5162011', '5162021'],
          name: { zh: '十年庆典', en: 'Celebration Mk 10' },
          desc: { zh: '泰拉瑞亚十周年！在这个多姿多彩的奇幻世界中一起庆祝——谁知道呢，也许团队留下了一些礼物等你拆开。', en: '10 years of Terraria! Join the party in this colorful world of whimsy – who knows, maybe the team left some gifts behind for you to open.' },
          icon: 'seed-icons/Celebration.png',
          wm: '2021',
        },
        {
          internal: 'TheConstant',
          codes: ['constant', 'the constant', 'eye 4 an eye', 'eye for an eye'],
          name: { zh: '恒常之地', en: 'The Constant' },
          desc: { zh: '将《饥荒》冒险融入到泰拉瑞亚中，你能否在战胜持续饥饿的同时找到泰拉瑞亚的拯救之道？哦，还有别忘了待在光明处！', en: 'Bringing the Don’t Starve Together adventure into Terraria, can you survive persistent hunger as you seek to save Terraria? Oh, and don’t forget to stay in the light!' },
          icon: 'seed-icons/TheConstant.png',
          wm: 'dst',
        },
        {
          internal: 'ForTheWorthy',
          codes: ['for the worthy'],
          name: { zh: '勇者之境', en: 'For the Worthy' },
          desc: { zh: '你够格吗？这是一个毫不留情的世界。忘掉过去的一切，磨炼你的本领，否则等待你的只有审视、衡量与淘汰……', en: 'Are you Worthy? This is a world of no mercy. Forget what you know and sharpen your skills, lest you be weighed, measured, and found wanting...' },
          icon: 'seed-icons/ForTheWorthy.png',
          wm: 'ftw',
        },
        {
          internal: 'NoTraps',
          codes: ['no traps'],
          name: { zh: '无机关', en: 'No Traps' },
          desc: { zh: '哇哦，陷阱。你讨厌它们，对吧？我也讨厌！这个世界肯定已经清除了所有陷阱……大概吧。也许。', en: 'Whoa, Traps. Ya hate ‘em, right? I hate them myself! This world has definitely been stripped of any and all traps... we think. Maybe.' },
          icon: 'seed-icons/NoTraps.png',
          wm: 'nt',
        },
        {
          internal: 'Remix',
          codes: ['dont dig up'],
          name: { zh: '再混合', en: 'Remix' },
          desc: { zh: '一片上下颠倒的大陆。在这场乾坤倒转的冒险中让泰拉瑞亚发生翻天覆地的变化。你是否有足够的勇气去探索上界？', en: 'A land where up is down and down is up. Turn Terraria on its head in this inverted adventure. Will you be brave enough to explore The Up?' },
          icon: 'seed-icons/Remix.png',
          wm: 'remix',
        },
        {
          internal: 'Everything',
          codes: ['get fixed boi'],
          name: { zh: '天顶剑', en: 'Zenith' },
          desc: { zh: 'For the Worthy 还不够？所有其他世界种子的主要特色，再加上一些全新的惊喜，这个世界只为击垮你而存在。准备受死吧，伙计！', en: 'For the Worthy wasn’t enough? Featuring aspects of every other world seed combined with some brand new surprises, this world is here to break you. Get fixed, boi!' },
          icon: 'seed-icons/Everything.gif',
          wm: 'zenith',
        },
        {
          internal: 'Skyblock',
          codes: ['skyblock'],
          name: { zh: '天空之岛', en: 'Skyblock' },
          desc: { zh: '踏入这片悬浮于天际的地域。初始资源微薄，你需白手起家，逐步构建属于你的世界。', en: 'Enter a realm floating in the sky. With little to start with, you must build up your world from humble beginnings.' },
          icon: 'seed-icons/Skyblock.png',
          wm: 'sky',
        },
      ],
    },
    {
      id: 'paint',
      name: { zh: '世界刷漆', en: 'World paint' },
      rows: [
        {
          internal: 'coatEverythingEcho',
          codes: ['invisible plane'],
          name: { zh: '回声世界', en: 'Coat everything Echo' },
          desc: { zh: '明明就在眼前，却无人察觉。（世界覆上了回声涂层）', en: 'Hidden in plain sight. (World is echo coated)' },
          wm: 'echo',
        },
        {
          internal: 'paintEverythingGray',
          codes: ['monochrome'],
          name: { zh: '灰度世界', en: 'Paint everything Gray' },
          desc: { zh: '回到那个更简单的时代，摆脱那些烦人的颜色！（世界被涂成灰色）', en: 'Journey back to a more simple time, without all of those pesky colors! (World is painted gray)' },
          wm: 'gray',
        },
        {
          internal: 'paintEverythingNegative',
          codes: ['negative infinity'],
          name: { zh: '反色世界', en: 'Paint everything Negative' },
          desc: { zh: '算了，反过来吧。（世界被涂成反色）', en: 'Scratch that, reverse it. (World is painted negative)' },
          wm: 'negative',
        },
        {
          internal: 'coatEverythingIlluminant',
          codes: ['x-ray vision'],
          name: { zh: '夜明世界', en: 'Coat everything Illuminant' },
          desc: { zh: '这里怎么这么亮？（世界覆上了发光涂层）', en: 'Why is it so bright in here? (World is illuminant coated)' },
          wm: 'glow',
        },
      ],
    },
    {
      id: 'worldgen',
      name: { zh: '世界生成', en: 'World generation' },
      rows: [
        {
          internal: 'digExtraHoles',
          codes: ['jagged rocks'],
          name: { zh: '多洞世界', en: 'Dig extra holes' },
          desc: { zh: '小心脚下！（世界有额外的裂隙和深坑）', en: 'Watch your step! (World has extra chasms and pits)' },
          wm: 'holes',
        },
        {
          internal: 'noSurface',
          codes: ['mole people'],
          name: { zh: '无地表', en: 'No surface' },
          desc: { zh: '地表什么的，过誉了……（世界没有地表层）', en: 'The outside is so overrated... (World has no surface layer)' },
          wm: 'nosurface',
        },
        {
          internal: 'roundLandmasses',
          codes: ['planetoids'],
          name: { zh: '圆形地块', en: 'Round landmasses' },
          desc: { zh: '哎呀，它们看起来就像一颗颗星球宝宝！（世界由小型星体组成）', en: 'Aww, they look like little baby planets! (World consists of small planetoids)' },
          wm: 'round',
        },
        {
          internal: 'surfaceIsInSpace',
          codes: ['such great heights'],
          name: { zh: '太空地表', en: 'Surface is in Space' },
          desc: { zh: '在太空，没人能听到你的尖叫。（地表层位置更高）', en: 'In space, no one can hear you scream. (Surface layer is higher)' },
          wm: 'space',
        },
        {
          internal: 'extraLiquid',
          codes: ['waterpark'],
          name: { zh: '多液世界', en: 'Extra liquid' },
          desc: { zh: '寻找亚特兰蒂斯之旅开始了！（世界被水淹没）', en: 'The search for Atlantis begins! (World is flooded)' },
          wm: 'liquid',
        },
      ],
    },
    {
      id: 'biome',
      name: { zh: '生物群系生成', en: 'Biome generation' },
      rows: [
        {
          internal: 'noSpiderCaves',
          codes: ['arachnophobia'],
          name: { zh: '无蜘蛛窝', en: 'No spider nests' },
          desc: { zh: '八条腿实在太多了。（世界没有蜘蛛洞）', en: 'Eight legs were far too many. (World has no spider caves)' },
          wm: 'nsc',
        },
        {
          internal: 'hallowOnTheSurface',
          codes: ['does that sparkle'],
          name: { zh: '地表神圣', en: 'Hallow on the surface' },
          desc: { zh: '彩虹、小猫和死亡。（世界拥有神圣地表）', en: 'Rainbows, kittens, and death. (World has a Hallowed surface)' },
          wm: 'hallow',
        },
        {
          internal: 'noInfection',
          codes: ['fish mox'],
          name: { zh: '无感染', en: 'No infection' },
          desc: { zh: '终于，我们找到了解药！（世界开局没有腐化或猩红）', en: 'Finally, we have found a cure! (World starts with no Corruption or Crimson)' },
          wm: 'noinfect',
        },
        {
          internal: 'worldIsInfected',
          codes: ['purify this'],
          name: { zh: '世界被感染', en: 'World is infected' },
          desc: { zh: '伙计，我们现在可真是摊上大麻烦了！（整个世界被腐化或猩红侵蚀）', en: 'We are in some real pretty stuff now, man! (Entire world is infected by Corruption or Crimson)' },
          wm: 'infected',
        },
        {
          internal: 'surfaceIsDesert',
          codes: ['sandy britches'],
          name: { zh: '沙漠地表', en: 'Surface is Desert' },
          desc: { zh: '就像海滩，但水少得多。（世界拥有沙漠地表）', en: 'Like the beach with a lot less water. (World has a Desert surface)' },
          wm: 'desert',
        },
        {
          internal: 'surfaceIsMushrooms',
          codes: ['toadstool'],
          name: { zh: '蘑菇地表', en: 'Surface is mushrooms' },
          desc: { zh: '听说松露人是个真菌子。（世界拥有蘑菇地表）', en: 'I hear that Truffle is a really fun guy. (World has a Mushroom surface)' },
          wm: 'mushroom',
        },
        {
          internal: 'worldIsFrozen',
          codes: ['winter is coming'],
          name: { zh: '冰封世界', en: 'World is frozen' },
          desc: { zh: '有些人总想逆坡滑冰……（世界由冰雪组成）', en: 'Some people are always trying to ice skate uphill... (World consists of snow and ice)' },
          wm: 'frozen',
        },
      ],
    },
    {
      id: 'structures',
      name: { zh: '结构生成', en: 'Structure generation' },
      rows: [
        {
          internal: 'biggerAbandonedHouses',
          codes: ['abandoned manors'],
          name: { zh: '巨大废屋', en: 'Bigger abandoned houses' },
          desc: { zh: '是哪个失落的文明建造了这一切？（世界拥有更大的地下小屋）', en: 'What lost civilization built all of this? (World has larger underground cabins)' },
          wm: 'manor',
        },
        {
          internal: 'addTeleporters',
          codes: ['beam me up'],
          name: { zh: '添加传送机', en: 'Add Teleporters' },
          desc: { zh: '走路是弱者的行为。（世界各地散布着传送机）', en: 'Walking is for losers. (World has teleporters scattered throughout)' },
          wm: 'tp',
        },
        {
          internal: 'actuallyNoTraps',
          codes: ['more traps please'],
          name: { zh: '真没陷阱', en: 'Actually no traps' },
          desc: { zh: '不，说真的。这次我们是认真的，保证！（世界没有陷阱）', en: 'No, seriously. We mean it this time, promise! (World has no traps)' },
          wm: 'ant',
        },
        {
          internal: 'halloweenGen',
          codes: ['pumpkin season'],
          name: { zh: '万圣节生成', en: 'Halloween gen' },
          desc: { zh: '现在就差个玉米迷宫了。（世界开局自带南瓜）', en: 'All we are missing now is a corn maze. (World starts with pumpkins)' },
          wm: 'hgen',
        },
        {
          internal: 'rainbowStuff',
          codes: ['rainbow road'],
          name: { zh: '彩虹要素', en: 'Rainbow stuff' },
          desc: { zh: '红橙黄绿蓝靛紫到此一游。（世界包含各类彩虹色物块及更多内容）', en: 'ROY G BIV was here. (World has all sorts of rainbow blocks and more)' },
          wm: 'rainbow',
        },
        {
          internal: 'extraLivingTrees',
          codes: ['save the rainforest'],
          name: { zh: '多生命树', en: 'Extra Living Trees' },
          desc: { zh: '还有什么比一棵快乐小树更棒的呢？一大片巨大的生命树！（世界拥有更多、更大的生命树）', en: 'What\'s better than a happy little tree? A whole bunch of giant Living Trees! (World has extra, much larger Living Trees)' },
          wm: 'tree',
        },
        {
          internal: 'extraFloatingIslands',
          codes: ['the care bears movie'],
          name: { zh: '多漂浮岛', en: 'Extra Floating Islands' },
          desc: { zh: '你总是爱做白日梦，想入云端。（世界拥有更多漂浮岛）', en: 'You always did have your head in the clouds. (World has extra Floating Islands)' },
          wm: 'island',
        },
        {
          internal: 'pooEverywhere',
          codes: ['truck stop'],
          name: { zh: '处处臭臭', en: 'Poo everywhere' },
          desc: { zh: '6号过道需要清理！（世界遍布臭臭块）', en: 'Cleanup on aisle 6! (World is covered in Poo blocks)' },
          wm: 'poo',
        },
        {
          internal: 'portalGunInChests',
          codes: ['we don\'t even test for that'],
          name: { zh: '宝箱传送枪', en: 'Portal Gun in Chests' },
          desc: { zh: '测试结果出来了：“你是个可怕的人。”（传送枪可在任何宝箱中生成）', en: 'Here Come The Test Results: \'You Are A Horrible Person.\' (Portal Gun can spawn in any chest)' },
          wm: 'pg',
        },
      ],
    },
    {
      id: 'passive',
      name: { zh: '被动效果', en: 'Passive effects' },
      rows: [
        {
          internal: 'rainsForAYear',
          codes: ['bring a towel'],
          name: { zh: '雨下整年', en: 'Rains for a year' },
          desc: { zh: '你恐怕需要一艘更大的船。（世界永无休止地下着雨）', en: 'You\'re going to need a bigger boat. (World has neverending rain)' },
          wm: 'rain',
        },
        {
          internal: 'endlessHalloween',
          codes: ['hocus pocus'],
          name: { zh: '无尽万圣', en: 'Endless Halloween' },
          desc: { zh: '不给糖就捣蛋！（万圣节事件始终开启）', en: 'Trick or treat! (Halloween event always active)' },
          wm: 'eh',
        },
        {
          internal: 'endlessChristmas',
          codes: ['jingle all the way'],
          name: { zh: '无尽圣诞', en: 'Endless Christmas' },
          desc: { zh: '看看树下有什么……（圣诞节事件始终开启）', en: 'Let\'s see what is under the tree... (Christmas event always active)' },
          wm: 'ec',
        },
        {
          internal: 'moreLightning',
          codes: ['electric boogaloo'],
          name: { zh: 'More lightning', en: 'More lightning' },
          desc: { zh: '宙斯不悦（更多雷击）', en: 'Zeus is displeased (More lightning strikes)' },
          wm: 'ml',
        },
        {
          internal: 'noLightning',
          codes: ['calm before the storm'],
          name: { zh: 'No lightning', en: 'No lightning' },
          desc: { zh: '宙斯息怒了（禁用雷击）', en: 'Zeus is appeased (Disables lightning strikes)' },
          wm: 'nl',
        },
      ],
    },
    {
      id: 'spawn',
      name: { zh: '生成点', en: 'Spawn points' },
      rows: [
        {
          internal: 'randomSpawn',
          codes: ['how did I get here'],
          name: { zh: '随机生成点', en: 'Random spawn' },
          desc: { zh: '我们到底在哪儿？（初始生成点随机）', en: 'Where the heck are we? (Starting spawn point in a random location)' },
          wm: 'rs',
        },
        {
          internal: 'teamBasedSpawns',
          codes: ['royale with cheese'],
          name: { zh: '团队生成点', en: 'Team based spawns' },
          desc: { zh: '离我们的地盘远点！（玩家生成点按队伍颜色区分）', en: 'Stay off of our turf! (Player spawns are specific to team colors)' },
          wm: 'team',
        },
      ],
    },
    {
      id: 'other',
      name: { zh: '其他效果', en: 'Other effects' },
      rows: [
        {
          internal: 'dualDungeons',
          codes: ['double daring dangers'],
          name: { zh: '对偶地牢', en: 'Dual Dungeons' },
          desc: { zh: '买一送一，地牢大放送！（双地牢探索体验）', en: 'Buy one Dungeon, get one free! (A dungeon crawling experience)' },
          wm: 'dual',
        },
        {
          internal: 'errorWorld',
          codes: ['I am error'],
          name: { zh: '错误世界', en: 'Error world' },
          desc: { zh: '猫狗同屋，天下大乱！（错误世界）', en: 'Cats and dogs, living together, mass hysteria! (Error world)' },
          wm: 'error',
        },
        {
          internal: 'graveyardBloodmoonStart',
          codes: ['night of the living dead'],
          name: { zh: '开局血月墓地', en: 'Graveyard Blood Moon start' },
          desc: { zh: '天灵灵，地灵灵……打个领带行不行？（世界遍布墓地，开局就是血月）', en: 'Klaatu Verata... Necktie! (World is filled with graveyards, starts on a Blood Moon)' },
          wm: 'gbm',
        },
        {
          internal: 'startInHardmode',
          codes: ['too easy'],
          name: { zh: '开局困难模式', en: 'Start in Hardmode' },
          desc: { zh: '看来，你选择了痛苦之路……（世界开局即为困难模式）', en: 'So, you have elected the way of pain... (World starts in Hardmode)' },
          wm: 'hardmode',
        },
        {
          internal: 'vampirism',
          codes: ['what a horrible night to have a curse'],
          name: { zh: '吸血鬼症', en: 'Vampirism' },
          desc: { zh: '你需要一支SPF9000的防晒霜。（玩家是吸血鬼——不惜一切代价避开阳光）', en: 'You are going to need some SPF9000. (Player is a Vampire - avoid the sun at all costs)' },
          icon: 'seed-icons/Vampirism.png',
          wm: 'vampire',
        },
      ],
    },
  ],
}

const MODIFIERS: ModifierTable = {
  kind: 'modifiers',
  id: 'modifiers',
  name: { zh: '词缀', en: 'Modifiers' },
  wiki: {
    zh: 'https://terraria.wiki.gg/zh/wiki/Modifiers',
    en: 'https://terraria.wiki.gg/wiki/Modifiers',
  },
  rows: MODIFIER_ROWS,
}

/** 「常用表格」里的资料表（「指令小抄」「常用链接」由页面单独作为 tab）。 */
export const COMMON_TABLES: CommonTable[] = [WORLD_SEEDS, MODIFIERS]

/** 按界面语言取文案。 */
export function tableText(text: LocalizedText, lang: Lang): string {
  return lang === 'en' ? text.en : text.zh
}
