import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs'

/**
 * Tabs 变体契约（对齐 shadcn 的 `line`）：
 * - 变体只写在 `TabsList` 上，list 带 `data-variant`，trigger 靠 `group-data-[variant=…]` 继承；
 * - `line` 的下划线是贴在 list 底边的一条 2px `after:` 伪元素，list 不再自己画底边轨道线。
 *
 * 「调用点又给 trigger 传 variant」用扫源码守：CSS 继承在 jsdom 里看不出来，
 * 但传了也不会报错（多一个被忽略的 prop），复制粘贴时最容易复发。
 */
const SRC = resolve(process.cwd(), 'src')

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

describe('Tabs', () => {
  it('变体写在 TabsList 上，并落到 data-variant', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="line" aria-label="下划线">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )

    const list = screen.getByRole('tablist', { name: '下划线' })
    expect(list.dataset.variant).toBe('line')
    expect(list.className).toContain('bg-transparent')
    // 轨道线由激活态的下划线代替，list 不再自己画底边
    expect(list.className).not.toContain('border-b')
  })

  it('默认是胶囊变体', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="胶囊">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )

    const list = screen.getByRole('tablist', { name: '胶囊' })
    expect(list.dataset.variant).toBe('default')
    expect(list.className).toContain('bg-accent')
  })

  it('切 tab 后面板跟着换', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="面板">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">面板 A</TabsContent>
        <TabsContent value="b">面板 B</TabsContent>
      </Tabs>,
    )

    expect(screen.getByText('面板 A')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('面板 B')).toBeTruthy()
  })

  it('调用点不要再给 TabsTrigger 传 variant', () => {
    const offenders = sourceFiles()
      .filter((path) => !path.endsWith(join('ui', 'Tabs.tsx')))
      .filter((path) => /<TabsTrigger\b[^>]*\svariant=/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))

    expect(offenders).toEqual([])
  })
})
