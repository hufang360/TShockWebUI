import { Check, X } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  InputGroup,
  InputGroupInput,
} from '@/components/ui'
import {
  COLLECTION_GROUPS,
  ITEM_COLLECTIONS,
  rangeTabLabel,
  type ItemCollection,
} from '@/lib/collections'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

export interface DexGroupEntry {
  token: string
  label: string
  meta: string
}

interface DexGroupDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupQuery: string
  onGroupQueryChange: (value: string) => void
  groupTabs: { id: string }[]
  tabCounts: number[]
  gameMode: boolean
  effectiveGroupTab: string
  isCollectionGroup: boolean
  mode: string
  collectionId: string
  openGroup: string
  onOpenGroupChange: (value: string) => void
  recentGroups: DexGroupEntry[]
  searchResults: DexGroupEntry[]
  onApplyToken: (token: string) => void
  onSelectGameTab: (tabId: string) => void
  onSelectCollection: (collection: ItemCollection) => void
}

/** 物品分组侧抽屉：制作界面页签 + 内置集合，支持搜索与最近使用。 */
export function DexGroupDrawer({
  open,
  onOpenChange,
  groupQuery,
  onGroupQueryChange,
  groupTabs,
  tabCounts,
  gameMode,
  effectiveGroupTab,
  isCollectionGroup,
  mode,
  collectionId,
  openGroup,
  onOpenGroupChange,
  recentGroups,
  searchResults,
  onApplyToken,
  onSelectGameTab,
  onSelectCollection,
}: DexGroupDrawerProps) {
  const { t } = useI18n()
  const searching = groupQuery.trim().length > 0

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) onGroupQueryChange('')
        if (next) onOpenGroupChange(gameMode ? 'game' : isCollectionGroup ? mode : 'game')
      }}
      swipeDirection="right"
    >
      <DrawerContent
        data-testid="dex-group-drawer"
        className="gap-0 p-0"
      >
        <DrawerHeader className="flex-row items-center border-b px-4 py-3">
          <DrawerTitle className="min-w-0 flex-1">{t('dex.collectionGroup')}</DrawerTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t('action.close')}
          >
            <X />
          </Button>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
          <InputGroup className="h-9">
            <InputGroupInput
              value={groupQuery}
              onChange={(e) => onGroupQueryChange(e.target.value)}
              placeholder={t('dex.groupSearch')}
              aria-label={t('dex.groupSearch')}
              className="text-sm"
            />
          </InputGroup>

          {!searching && recentGroups.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="px-1 text-2xs text-muted-foreground">{t('dex.groupRecent')}</span>
              <div className="grid grid-cols-2 gap-1">
                {recentGroups.map((entry) => (
                  <button
                    key={entry.token}
                    type="button"
                    onClick={() => onApplyToken(entry.token)}
                    className="flex min-w-0 cursor-pointer flex-col rounded-md bg-accent/50 px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-xs text-foreground">{entry.label}</span>
                    <span className="truncate text-2xs text-muted-foreground">{entry.meta}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searching ? (
            searchResults.length > 0 ? (
              <div data-testid="dex-group-search-results" className="grid grid-cols-1 gap-1">
                {searchResults.map((entry) => (
                  <button
                    key={entry.token}
                    type="button"
                    onClick={() => onApplyToken(entry.token)}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.label}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{entry.meta}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t('dex.groupNoMatch')}
              </p>
            )
          ) : (
            <Accordion
              type="single"
              collapsible
              value={openGroup}
              onValueChange={onOpenGroupChange}
              className="flex flex-col"
            >
              <AccordionItem
                value="game"
                className="px-0"
              >
                <AccordionTrigger className="py-2 text-sm font-medium text-foreground">
                  {t('dex.tabs')}
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-2xs text-muted-foreground tabular-nums">
                    {groupTabs.length}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-2 gap-x-1">
                    {groupTabs.map((tab, index) => {
                      const active = gameMode && effectiveGroupTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          aria-pressed={active}
                          data-group-active={active || undefined}
                          onClick={() => {
                            onSelectGameTab(tab.id)
                            onOpenChange(false)
                          }}
                          className={cn(
                            'flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'bg-accent font-medium',
                          )}
                        >
                          <span className="truncate">{t(`dex.tab.${tab.id}`)}</span>
                          <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                            {tabCounts[index] ?? 0}
                          </span>
                          {active && <Check className="size-3 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {COLLECTION_GROUPS.map((group) => {
                const list = ITEM_COLLECTIONS.filter((c) => c.group === group)
                return (
                  <AccordionItem
                    key={group}
                    value={group}
                    className="px-0"
                  >
                    <AccordionTrigger className="py-2 text-sm font-medium text-foreground">
                      {t(`dex.group.${group}`)}
                      <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-2xs text-muted-foreground tabular-nums">
                        {list.length}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-x-1">
                        {list.map((collection) => {
                          const active = collectionId === collection.id
                          return (
                            <button
                              key={collection.id}
                              type="button"
                              aria-pressed={active}
                              data-group-active={active || undefined}
                              onClick={() => {
                                onSelectCollection(collection)
                                onOpenChange(false)
                              }}
                              className={cn(
                                'flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                active && 'bg-accent font-medium',
                              )}
                            >
                              <span className="truncate">
                                {collection.group === 'range'
                                  ? rangeTabLabel(collection)
                                  : collection.name}
                              </span>
                              <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                                {collection.ids.length}
                              </span>
                              {active && <Check className="size-3 shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </div>

        <DrawerFooter className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            {t('action.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
