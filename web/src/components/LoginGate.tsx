import { Button, Card, CardBody } from '@/components/ui'
import { useI18n } from '@/lib/i18n'

interface LoginGateProps {
  /** 点击「登录」时打开登录框。 */
  onLogin: () => void
}

/**
 * 未登录时统一的占位提示：隐藏页面自身内容，只显示「请先登录！」+ 登录按钮。
 *
 * 首页 / 指令 / 指令卡片模块 / 玩家管理 / 鱼店 / 设置共用（`docs/设计原则与约束.md` §4.6：
 * token 只在后端，页面级数据都要登录后才能拉取）。
 */
export function LoginGate({ onLogin }: LoginGateProps) {
  const { t } = useI18n()
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-sm text-foreground/80">{t('login.required')}</p>
        <Button variant="primary" onClick={onLogin}>
          {t('action.login')}
        </Button>
      </CardBody>
    </Card>
  )
}
