const BASE = import.meta.env.BASE_URL

/**
 * 创意菜单页签图标（物品图鉴 → 结果区左上角那排分类按钮）。
 *
 * 图源 `Content/Images/UI/Creative/Infinite_Icons.png`：330×30，横排 11 帧 30×30，
 * 帧顺序 = 游戏内页签顺序。已按页签 id 切成 `data/dex-tab-icons/<id>.png`（帧号对照表见
 * `docs/页面-物品图鉴.md`），所以这里只需要拼路径，没有映射表可漏。
 */
export function dexTabIconUrl(tabId: string): string {
  return `${BASE}data/dex-tab-icons/${tabId}.png`
}
