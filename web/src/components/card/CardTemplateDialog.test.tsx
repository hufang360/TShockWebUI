import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { templateFromSet } from '@/lib/cardParams'
import { NO_INGAME } from '@/lib/ingame'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { CardTemplateDialog } from './CardTemplateDialog'

const dataset = makeDataset()
const give = dataset.commands.find((c) => c.name === 'give')!
const giveSet = give.paramSets![0]!

function renderDialog(overrides: Partial<Parameters<typeof CardTemplateDialog>[0]> = {}) {
  const onSubmit = vi.fn()
  const onOpenChange = vi.fn()
  const utils = render(
    <I18nProvider lang="zh">
      <CardTemplateDialog
        open
        onOpenChange={onOpenChange}
        dataset={dataset}
        ingame={NO_INGAME}
        players={['Alice']}
        onSubmit={onSubmit}
        submitLabel="添加"
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onSubmit, onOpenChange, ...utils }
}

/** 点指令列表里的一条（行文本以 `/名字` 开头）。 */
function pickCommand(name: string) {
  const label = screen.getByText(`/${name}`)
  fireEvent.click(label.closest('button') as HTMLElement)
}

describe('CardTemplateDialog', () => {
  it('搜指令 → 选一条 → 参数按默认策略铺开 → 提交带上模板', () => {
    const { onSubmit } = renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: 'give' } })
    pickCommand('give')

    // 名称默认是 `/give`，参数表里两个必填参数都在
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('/give')
    expect(screen.getByLabelText('item type/id')).toBeTruthy()
    expect(screen.getByLabelText('player')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '/give',
      command: '/give',
      template: templateFromSet('give', giveSet),
    })
  })

  it('可以只写一条完整指令（不进参数表）', () => {
    const { onSubmit } = renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: '/say hello' } })
    fireEvent.click(screen.getByRole('button', { name: '使用「/say hello」' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '公告' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: '公告', command: '/say hello' })
  })

  it('搜不到指令时给出空态，不留一个空列表', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: 'zzzz' } })
    expect(screen.getByText('没有匹配的指令')).toBeTruthy()
  })

  it('只能在游戏内执行的指令：标「仅游戏内」且不能保存', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: 'item' } })
    pickCommand('item')
    expect(screen.getByText('仅游戏内')).toBeTruthy()
    expect(screen.getByText(/只能在游戏内执行/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加' }).hasAttribute('disabled')).toBe(true)
  })

  it('多形态指令（/group）可以选用法', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: 'group' } })
    pickCommand('group')
    expect(screen.getByLabelText('用法')).toBeTruthy()
  })

  it('编辑已有参数卡片：名称 / 参数值回填，保存时一并提交', () => {
    const template = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'fixed', value: '29' }
    template.args[1] = { mode: 'fill', value: '' }
    const { onSubmit } = renderDialog({
      initial: { name: '给物品', command: '/give', template },
    })
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('给物品')
    fireEvent.change(screen.getByLabelText('player'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '给物品',
      command: '/give',
      template: { ...template, args: [template.args[0], { mode: 'fill', value: 'Alice' }, template.args[2], template.args[3]] },
    })
  })

  it('没有任何参数时建成普通卡片（不存模板）', () => {
    const { onSubmit } = renderDialog()
    fireEvent.change(screen.getByLabelText('搜索指令'), { target: { value: 'help' } })
    pickCommand('help')
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: '/help', command: '/help', template: undefined })
  })
})
