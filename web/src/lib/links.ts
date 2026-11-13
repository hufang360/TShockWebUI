import type { LocalizedText } from '@/lib/commonTables'

/**
 * 「常用链接」页的数据。
 *
 * - 中英分开：中文界面给 wiki 的中文条目、英文条目给英文站点（`/zh/wiki/...` vs `/wiki/...`）。
 * - wiki 部分只列**本项目真的会用到**的页面（数据 ID 页脚、物品详情的「前往 Wiki」、常用表格自己的 wiki 按钮）。
 * - 新增链接只改这个数组。
 */
export interface CommonLink {
  id: string
  label: LocalizedText
  href: LocalizedText
}

export interface LinkGroup {
  id: string
  name: LocalizedText
  links: CommonLink[]
}

const WIKI_ZH = 'https://terraria.wiki.gg/zh/wiki/'
const WIKI_EN = 'https://terraria.wiki.gg/wiki/'

/** wiki 条目：中文用中文条目名（浏览器会自动把非 ASCII 编码进地址），英文用英文标题。 */
const wiki = (id: string, zhPath: string, enPath: string, label: LocalizedText): CommonLink => ({
  id,
  label,
  href: { zh: `${WIKI_ZH}${zhPath}`, en: `${WIKI_EN}${enPath}` },
})

const both = (zh: string, en: string): LocalizedText => ({ zh, en })

export const LINK_GROUPS: LinkGroup[] = [
  {
    id: 'wiki',
    name: both('泰拉瑞亚 Wiki', 'Terraria Wiki'),
    links: [
      wiki('wiki-data', '数据_ID', 'Data_IDs', both('数据 ID', 'Data IDs')),
      wiki('wiki-npc', 'NPC_ID', 'NPC_IDs', both('NPC ID', 'NPC IDs')),
      wiki('wiki-tile', '图格_ID', 'Tile_IDs', both('图格 ID', 'Tile IDs')),
      wiki('wiki-wall', '墙_ID', 'Wall_IDs', both('墙 ID', 'Wall IDs')),
      wiki('wiki-buff', '增益_ID', 'Buff_IDs', both('增益 ID', 'Buff IDs')),
      wiki('wiki-projectile', 'Projectile_IDs', 'Projectile_IDs', both('射弹 ID', 'Projectile IDs')),
      wiki(
        'wiki-secret-seeds',
        'Secret_world_seeds',
        'Secret_world_seeds',
        both('秘密世界种子', 'Secret world seeds'),
      ),
      wiki(
        'wiki-special-seeds',
        'Special_world_seeds',
        'Special_world_seeds',
        both('特殊世界种子', 'Special world seeds'),
      ),
      wiki('wiki-modifiers', 'Modifiers', 'Modifiers', both('修饰语（词缀）', 'Modifiers')),
    ],
  },
  {
    id: 'tshock',
    name: both('TShock 相关', 'TShock'),
    links: [
      {
        id: 'repo',
        label: both('本项目仓库', 'Project repository'),
        href: both(
          'https://github.com/hufang360/TShockWebUI',
          'https://github.com/hufang360/TShockWebUI',
        ),
      },
      {
        id: 'pages',
        label: both('本项目在线演示（GitHub Pages）', 'Project demo (GitHub Pages)'),
        href: both(
          'https://hufang360.github.io/TShockWebUI/',
          'https://hufang360.github.io/TShockWebUI/',
        ),
      },
      {
        id: 'tshock',
        label: both('TShock 发布页', 'TShock releases'),
        href: both(
          'https://github.com/Pryaxis/TShock/releases',
          'https://github.com/Pryaxis/TShock/releases',
        ),
      },
      {
        id: 'itshock',
        label: both('hf 的 TShock 插件（iTShock）', "hf's TShock plugins (iTShock)"),
        href: both(
          'https://github.com/hufang360/iTShock',
          'https://github.com/hufang360/iTShock',
        ),
      },
      {
        id: 'player-manager',
        label: both('TShockPlayerManager（玩家管理插件）', 'TShockPlayerManager (plugin)'),
        href: both(
          'https://github.com/hufang360/TShockPlayerManager/',
          'https://github.com/hufang360/TShockPlayerManager/',
        ),
      },
      {
        id: 'world-modify',
        label: both('TShockWorldModify（世界管理插件）', 'TShockWorldModify (plugin)'),
        href: both(
          'https://github.com/hufang360/TShockWorldModify/',
          'https://github.com/hufang360/TShockWorldModify/',
        ),
      },
    ],
  },
  {
    id: 'tools',
    name: both('工具链', 'Toolchain'),
    links: [
      {
        id: 'terrasavr',
        label: both('玩家存档编辑器（TerraSavr）', 'Player save editor (TerraSavr)'),
        href: both('https://yal.cc/r/terrasavr/', 'https://yal.cc/r/terrasavr/'),
      },
      {
        id: 'tedit',
        label: both('TEdit 地图编辑器（下载）', 'TEdit map editor (releases)'),
        href: both(
          'https://github.com/TEdit/Terraria-Map-Editor/releases',
          'https://github.com/TEdit/Terraria-Map-Editor/releases',
        ),
      },
      {
        id: 'tedit-web',
        label: both('TEdit 网页版', 'TEdit web editor'),
        href: both('https://terraria-map-editor.com/', 'https://terraria-map-editor.com/'),
      },
      {
        id: 'terramap',
        label: both('TerraMap（Windows）', 'TerraMap (Windows)'),
        href: both('https://github.com/TerraMap/windows', 'https://github.com/TerraMap/windows'),
      },
      {
        id: 'terramap-web',
        label: both('TerraMap 网页版', 'TerraMap web'),
        href: both('https://terramap.github.io/index.html', 'https://terramap.github.io/index.html'),
      },
      {
        id: 'tconvert',
        label: both('TConvert（材质包转换）', 'TConvert (texture pack converter)'),
        href: both(
          'https://github.com/trigger-segfault/TConvert/releases',
          'https://github.com/trigger-segfault/TConvert/releases',
        ),
      },
      {
        id: 'workshop-lang',
        label: both('语言材质包（创意工坊）', 'Language packs (Steam Workshop)'),
        href: both(
          'https://steamcommunity.com/workshop/browse/?appid=105600&requiredtags%5B%5D=Language%2FTranslations',
          'https://steamcommunity.com/workshop/browse/?appid=105600&requiredtags%5B%5D=Language%2FTranslations',
        ),
      },
    ],
  },
  {
    id: 'community',
    name: both('社区', 'Community'),
    links: [
      {
        id: 'forums',
        label: both('泰拉瑞亚官方论坛', 'Terraria forums'),
        href: both('https://forums.terraria.org/index.php', 'https://forums.terraria.org/index.php'),
      },
      {
        id: 'bbstr',
        label: both('泰拉瑞亚中文论坛（TShock 插件）', 'Chinese forum (TShock plugins)'),
        href: both('https://www.bbstr.net/', 'https://www.bbstr.net/'),
      },
    ],
  },
]
