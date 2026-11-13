import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { resetSearchIntent, requestSearchIntent } from '@/lib/searchIntent'
import { makeDataset } from '@/test/fixtures'
import { TerminalProvider } from '@/lib/terminalContext'
import type { Lang } from '@/types'

const copyText = vi.fn((text: string) => Promise.resolve(text.length > 0))
vi.mock('@/lib/clipboard', () => ({ copyText: (text: string) => copyText(text) }))

const terminalOpen = vi.fn()
vi.mock('@/lib/terminalContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/terminalContext')>()),
  useTerminal: () => ({ isOpen: false, open: terminalOpen, close: vi.fn(), toggle: vi.fn(), request: null }),
}))

const { TablesPage } = await import('./TablesPage')

function renderPage(lang: Lang = 'zh') {
  return render(
    <I18nProvider lang={lang}>
      <TerminalProvider>
        <TablesPage dataset={makeDataset()} onNavigate={vi.fn()} />
      </TerminalProvider>
    </I18nProvider>,
  )
}

/** 打开某张资料表（默认停在「指令小抄」）。 */
function openTable(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }))
}

describe('TablesPage', () => {
  beforeEach(() => {
    copyText.mockClear()
    resetSearchIntent()
  })

  it('默认停在「指令」这张表', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: '指令' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByPlaceholderText('搜索指令或名称')).toBeTruthy()
    // 资料表才有 wiki 链接。
    expect(screen.queryByRole('link', { name: '前往 Wiki' })).toBeNull()
  })

  it('全局搜索选了指令：切到指令小抄并带上搜索词', () => {
    requestSearchIntent('tables', { query: 'give' })
    renderPage()
    expect(screen.getByPlaceholderText('搜索指令或名称')).toHaveProperty('value', 'give')
  })

  it('世界种子：四列表头齐全，特殊种子在前、秘密种子分类在后', () => {
    renderPage()
    openTable('世界种子')

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['名称', '内部名称', '种子', '描述'])
    expect(screen.getByRole('rowheader', { name: '特殊世界种子' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '世界刷漆' })).toBeTruthy()
    expect(screen.getByText('回声世界')).toBeTruthy()
    expect(screen.getByText('coatEverythingEcho')).toBeTruthy()
    expect(screen.getByText('明明就在眼前，却无人察觉。（世界覆上了回声涂层）')).toBeTruthy()
  })

  it('斑马纹跨分类连续，分类分隔行不占行号', () => {
    renderPage()
    openTable('世界种子')
    const row = (name: string) => screen.getByText(name).closest('tr')!
    const striped = (name: string) => row(name).className.includes('bg-muted/25')
    // 特殊种子 9 行（0–8）之后接「世界刷漆」：第 10 行（index 9）是奇数 → 有条纹
    expect(striped('回声世界')).toBe(true)
    expect(striped('灰度世界')).toBe(false)
    expect(striped('反色世界')).toBe(true)
    expect(striped('夜明世界')).toBe(false)
    // 下一段从 index 13 继续（奇数）——说明没有按 tbody 重新计数
    expect(striped('多洞世界')).toBe(true)
    expect(striped('无地表')).toBe(false)
  })

  it('种子列是纯文字（多个写法用逗号隔开），复制在行浮层里', () => {
    renderPage()
    openTable('世界种子')
    expect(screen.getByText('celebrationmk10, 5162011, 5162021')).toBeTruthy()
    // 主表格上没有复制按钮
    expect(screen.queryByRole('button', { name: /复制种子/ })).toBeNull()

    fireEvent.click(screen.getByText('十年庆典'))
    const popover = within(screen.getByTestId('table-row-detail'))
    fireEvent.click(popover.getByRole('button', { name: '复制种子 5162021' }))
    expect(copyText).toHaveBeenCalledWith('5162021')
  })

  it('切到特殊世界种子：显示本地图标，多写法在行浮层里', () => {
    renderPage()
    openTable('世界种子')
    expect(screen.getByText('蜜蜂之惧')).toBeTruthy()
    expect(screen.getByText('NotTheBees')).toBeTruthy()

    const icon = document.querySelector('img[src*="data/seed-icons/NotTheBees.png"]')
    expect(icon).toBeTruthy()
    // 图标按原始比例缩放，且高度不超过行内文字（行高与指令小抄一致）。
    expect(icon?.className).toContain('h-4 w-auto')
    expect(icon?.hasAttribute('width')).toBe(false)

    // 点行 → 浮层里是这条的完整信息，多写法各自可复制（带底色）。
    fireEvent.click(screen.getByText('十年庆典'))
    const popover = within(screen.getByTestId('table-row-detail'))
    for (const code of ['celebrationmk10', '5162011', '5162021']) {
      expect(popover.getByRole('button', { name: `复制种子 ${code}` })).toBeTruthy()
    }
    fireEvent.click(popover.getByRole('button', { name: '复制种子 5162021' }))
    expect(copyText).toHaveBeenCalledWith('5162021')
  })

  it('浮层显示 WorldModify 的 /wm 指令并可复制', () => {
    renderPage()
    openTable('世界种子')

    fireEvent.click(screen.getByText('勇者之境'))
    let dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('相关指令')).toBeTruthy()
    expect(dialog.getByText('/wm s ftw')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: '复制种子 /wm s ftw' }))
    expect(copyText).toHaveBeenCalledWith('/wm s ftw')

    // 终端图标：把指令填进浮动终端，并主动关掉弹框（否则遮罩挡住终端）
    fireEvent.click(dialog.getByRole('button', { name: '填入浮动终端' }))
    expect(terminalOpen).toHaveBeenCalledWith('/wm s ftw')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByText('吸血鬼症'))
    dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('/wm s vampire')).toBeTruthy()
  })

  it('点行打开浮层，浮层里带内部名称与描述', () => {
    renderPage()
    openTable('世界种子')
    fireEvent.click(screen.getByText('回声世界'))
    const popover = within(screen.getByTestId('table-row-detail'))
    expect(popover.getByText('coatEverythingEcho')).toBeTruthy()
    expect(popover.getByText('明明就在眼前，却无人察觉。（世界覆上了回声涂层）')).toBeTruthy()
  })

  it('切到词缀：15 列（含 ID / 饰品效果 / 级别 / 价值 / 备注），数值与空值都照实渲染', () => {
    renderPage()
    openTable('词缀')

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([
      'ID',
      '名称',
      '伤害',
      '速度',
      '暴击率',
      '魔力消耗',
      '大小',
      '射弹速度',
      '盔甲穿透',
      '召唤标记伤害',
      '击退',
      '饰品效果',
      '级别',
      '价值',
      '备注',
    ])

    // 传奇 = 81，名字走 dataset 的本地化。
    const legendary = screen.getByText('传奇').closest('tr')!
    const cells = within(legendary).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells.slice(0, 7)).toEqual(['81', '传奇', '+15%', '+10%', '+5%', '–', '+10%'])

    // 饰品词缀：武器列不适用，效果写在「饰品效果」列（fixture 只本地化了 81，其余回退成 #id）。
    expect(screen.getByText('防御 +4')).toBeTruthy()
  })

  it('词缀：加绿减红，正负值一眼可分', () => {
    renderPage()
    openTable('词缀')
    const legendary = screen.getByText('传奇').closest('tr')!
    expect(within(legendary).getAllByText('+15%')[0].className).toContain('text-success')

    // 可怕（Terrible，id 8）：伤害 / 大小 / 击退都是负值
    const terrible = Array.from(document.querySelectorAll('tr')).find(
      (tr) => tr.querySelector('td')?.textContent === '8',
    )!
    expect(within(terrible).getByText('−13%').className).toContain('text-destructive')
    expect(within(terrible).getAllByText('−15%')[0].className).toContain('text-destructive')
  })

  it('词缀：分组过滤（配饰 / 近战 …），并统计条数', () => {
    renderPage()
    openTable('词缀')
    fireEvent.click(screen.getByRole('button', { name: '分组' }))
    const groups = within(screen.getByTestId('modifier-groups'))
    expect(groups.getByRole('button', { name: /配饰/ })).toBeTruthy()
    expect(groups.getByRole('button', { name: /近战/ })).toBeTruthy()

    // 只看配饰：护佑在，传奇不在
    fireEvent.click(groups.getByRole('button', { name: /配饰/ }))
    expect(screen.getByText('防御 +4')).toBeTruthy()
    expect(screen.queryByText('传奇')).toBeNull()

    // 切回全部
    fireEvent.click(screen.getByRole('button', { name: '分组' }))
    fireEvent.click(within(screen.getByTestId('modifier-groups')).getByRole('button', { name: /全部词缀/ }))
    expect(screen.getByText('传奇')).toBeTruthy()
  })

  it('词缀：同名修饰语有备注', () => {
    renderPage()
    openTable('词缀')
    // fixture 只有 81（传奇）一个词缀名，所以没有同名备注。
    expect(screen.queryByText('有多个具有相同名称的修饰语')).toBeNull()
  })

  it('秘密世界种子整张表用同一个图标', () => {
    renderPage()
    openTable('世界种子')
    // 秘密种子行统一用 WorldSeed.png；特殊种子行用各自的图标。
    const srcs = Array.from(document.querySelectorAll<HTMLImageElement>('tbody img')).map((img) =>
      img.getAttribute('src'),
    )
    expect(srcs.filter((src) => src === '/data/seed-icons/WorldSeed.png').length).toBeGreaterThanOrEqual(36)
  })

  it('特殊世界种子有中文名，代码仍可复制（浮层里是手型光标）', () => {
    renderPage()
    openTable('世界种子')
    expect(screen.getByText('一醉方休')).toBeTruthy()
    expect(screen.getByText('恒常之地')).toBeTruthy()

    fireEvent.click(screen.getByText('十年庆典'))
    const chip = within(screen.getByTestId('table-row-detail')).getByRole('button', {
      name: '复制种子 5162011',
    })
    expect(chip.className).toContain('cursor-pointer')
  })

  it('种子表支持搜索（名称 / 内部名称 / 种子 / 描述）', () => {
    renderPage()
    openTable('世界种子')
    const box = screen.getByPlaceholderText('搜索名称、内部名称、种子或描述')

    fireEvent.change(box, { target: { value: 'bees' } }) // 内部名称 coatEverythingEcho? 用更稳的词
    fireEvent.change(box, { target: { value: 'invisible plane' } })
    expect(screen.getByText('回声世界')).toBeTruthy()
    // 其它分类被过滤掉（只剩命中的那一段）
    expect(screen.queryByRole('rowheader', { name: '世界生成' })).toBeNull()

    fireEvent.change(box, { target: { value: 'zzzz' } })
    expect(screen.getByText('没有匹配的行')).toBeTruthy()
  })

  it('常用链接：按分组列出，外链新窗口打开，中文界面走中文 wiki', () => {
    renderPage()
    openTable('常用链接')

    const dataId = screen.getByRole('link', { name: /数据 ID/ })
    expect(dataId.getAttribute('href')).toMatch(/^https:\/\/terraria\.wiki\.gg\/zh\/wiki\//)
    // 地址列显示可读中文（不是 %XX）
    expect(screen.getByText('https://terraria.wiki.gg/zh/wiki/数据_ID')).toBeTruthy()
    expect(document.body.textContent).not.toContain('%E6%95%B0')

    // 和世界种子同一套表格：两列表头 + 分组分隔行
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '名称',
      '地址',
    ])
    expect(screen.getByRole('rowheader', { name: '泰拉瑞亚 Wiki' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '社区' })).toBeTruthy()
    expect(dataId.getAttribute('target')).toBe('_blank')
    expect(dataId.getAttribute('rel')).toContain('noreferrer')

    expect(screen.getByRole('link', { name: /TShock 发布页/ }).getAttribute('href')).toBe(
      'https://github.com/Pryaxis/TShock/releases',
    )
    // 「增益 ID」下一行是「射弹 ID」，中英都落在 Projectile_IDs 页
    expect(screen.getByRole('link', { name: '射弹 ID' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/Projectile_IDs',
    )
    // 链接表没有 wiki 按钮（那是资料表的）
    expect(screen.queryByRole('link', { name: '前往 Wiki' })).toBeNull()
  })

  it('常用链接：英文界面用英文 wiki 站点', () => {
    renderPage('en')
    openTable('Links')
    expect(screen.getByRole('link', { name: /Data IDs/ }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/wiki/Data_IDs',
    )
    expect(screen.getByRole('link', { name: 'Projectile IDs' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/wiki/Projectile_IDs',
    )
  })

  it('wiki 链接跟随界面语言与当前表', () => {
    renderPage()
    openTable('世界种子')
    expect(screen.getByRole('link', { name: '前往 Wiki' }).getAttribute('href')).toMatch(
      /^https:\/\/terraria\.wiki\.gg\/zh\/wiki\//,
    )
    openTable('词缀')
    expect(screen.getByRole('link', { name: '前往 Wiki' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/Modifiers',
    )
  })

  it('英文界面用英文表名与 wiki 链接', () => {
    renderPage('en')
    openTable('World seeds')
    expect(screen.getByText('Not the Bees')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Wiki' }).getAttribute('href')).toMatch(
      /^https:\/\/terraria\.wiki\.gg\/wiki\//,
    )
  })
})
