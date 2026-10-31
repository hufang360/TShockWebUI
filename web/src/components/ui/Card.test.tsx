import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('使用 shadcn 标准卡片表面且不投影', () => {
    render(<Card data-testid="card" />)
    const className = screen.getByTestId('card').className
    expect(className).toContain('rounded-container')
    expect(className).toContain('border')
    expect(className).toContain('bg-card')
    expect(className).not.toContain('shadow-sm')
    expect(className).not.toContain('rounded-sm')
    expect(className).not.toContain('border-[0.25px]')
  })
})
