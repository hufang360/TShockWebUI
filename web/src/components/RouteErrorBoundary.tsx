import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'

interface RouteErrorBoundaryProps {
  children: ReactNode
}

interface RouteErrorBoundaryState {
  failed: boolean
}

/**
 * 懒加载页面失败兜底：常见于部署后旧 chunk 已不存在。
 * 不吞掉异常细节，但主界面只给玩家一个明确动作：重新加载页面。
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route chunk failed to load', error, info)
  }

  render() {
    if (this.state.failed) return <RouteLoadError />
    return this.props.children
  }
}

function RouteLoadError() {
  const { t } = useI18n()
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t('app.routeLoadError')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{t('app.routeLoadErrorHint')}</span>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          {t('app.reload')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
