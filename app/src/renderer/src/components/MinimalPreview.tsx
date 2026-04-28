import {
  Download,
  Grid3x3,
  ZoomIn,
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronDown,
  FileText,
  FileJson,
  X,
  Check,
  AlertCircle,
  MessageSquarePlus
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { PageSlide, ExcalidrawPage } from '../../../shared/types'
import { useExport } from '../hooks/useExport'

interface MinimalPreviewProps {
  projectId: number
  projectName: string
  onBackToEditor?: () => void
}

type Phase = 'loading' | 'generating' | 'ready' | 'error' | 'empty'

/** 排队中：三个点错峰跳动 */
function QueuedOverlay({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span className="text-xs text-gray-400">排队中 · {title}</span>
    </div>
  )
}

/** 正在生成：渐变 conic 旋转环 + 扫光 shimmer */
function StreamingOverlay({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="size-full relative flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-indigo-50 via-white to-purple-50 overflow-hidden">
      {/* shimmer 扫光 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(110deg, transparent 30%, rgba(99,102,241,0.08) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2.2s linear infinite'
        }}
      />
      {/* 渐变旋转环 */}
      <div
        className="w-14 h-14 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, #818cf8 90deg, #a855f7 180deg, transparent 360deg)',
          WebkitMask: 'radial-gradient(circle, transparent 56%, black 58%)',
          mask: 'radial-gradient(circle, transparent 56%, black 58%)',
          animation: 'spin 1.1s linear infinite'
        }}
      />
      <span className="text-xs text-indigo-500/80 tracking-wide">正在生成 · {title}</span>
    </div>
  )
}

/** 尚未生成：静态占位，提示用户手动触发 */
function NotGeneratedOverlay(): React.JSX.Element {
  return (
    <div className="size-full flex flex-col items-center justify-center gap-2 bg-gray-50">
      <Sparkles className="w-6 h-6 text-gray-300" />
      <span className="text-xs text-gray-400">尚未生成</span>
    </div>
  )
}

/**
 * 单页 Excalidraw 渲染器
 *
 * - mode="thumbnail": 只展示成品，禁用交互与工具栏，自动缩放至容器大小
 * - mode="focus":     保留工具栏可缩放/编辑
 */
function SlideCanvas({
  page,
  mode,
  onChange
}: {
  page: ExcalidrawPage | undefined
  mode: 'thumbnail' | 'focus'
  /** focus 模式下，用户对画布的修改会通过此回调上报（thumbnail 模式无效） */
  onChange?: (
    pageIndex: number,
    elements: readonly unknown[],
    appState: Record<string, unknown>
  ) => void
}): React.JSX.Element {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isThumb = mode === 'thumbnail'
  // 把最新 onChange 放进 ref，避免每次父组件重渲染都重建 handler
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  // Excalidraw 实际正在渲染哪一页：仅在 mount / updateScene 完成后更新。
  // 用于在跨页切换的中间态屏蔽陈旧的 onChange（闭包里 page 已是新页但画布还是旧页）。
  const displayedPageRef = useRef<number | null>(null)
  // 用户发生 onChange 时把当前页的 pageIndex 存入这里；下一次 page prop 变化来自
  // 父级 flush「把同一页回灌」时跳过 updateScene，保留 selection/undo 历史。
  const skipSyncForPageRef = useRef<number | null>(null)

  // 适配当前容器：先 update scene，再双 rAF 后 fit，保证 canvas 尺寸已就绪
  const fitNow = useCallback(() => {
    const api = apiRef.current
    if (!api || !page) return
    const elements = page.elements as never
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        api.scrollToContent(elements, {
          fitToViewport: true,
          animate: false,
          viewportZoomFactor: 1
        })
      })
    })
  }, [page])

  // elements 变化时重置画布并重新 fit
  useEffect(() => {
    if (!apiRef.current || !page) return
    // 「同一页被父级 flush 回灌」：画布已是该页 + skip ref 也是该页，跳过以保留内部状态
    if (
      skipSyncForPageRef.current === page.pageIndex &&
      displayedPageRef.current === page.pageIndex
    ) {
      skipSyncForPageRef.current = null
      return
    }
    apiRef.current.updateScene({ elements: page.elements as never })
    // 仅在真正完成 updateScene 后才更新「画布当前在看哪一页」
    displayedPageRef.current = page.pageIndex
    skipSyncForPageRef.current = null
    fitNow()
  }, [page, fitNow])

  // 监听容器尺寸变化（网格布局完成、缩放、切换视图都会触发）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      fitNow()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitNow])

  if (!page) {
    return (
      <div className="size-full flex items-center justify-center text-gray-300">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`size-full ${isThumb ? 'pointer-events-none' : ''}`}>
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api
          // 初次 mount 时，initialData 已把 page.elements 画上画布，可以认为已同步
          if (page) displayedPageRef.current = page.pageIndex
          fitNow()
        }}
        initialData={{
          elements: page.elements as never,
          appState: { ...(page.appState ?? {}), viewBackgroundColor: '#ffffff' },
          scrollToContent: true
        }}
        onChange={(elements, appState) => {
          // thumbnail 模式只读，不上报
          if (isThumb) return
          // 陈旧 onChange：Excalidraw 还没跟上当前 page prop（跨页切换中间态）。
          // 这时画布上的元素仍是上一页的内容，千万不能拿这些元素以新页的 pageIndex 写回。
          if (displayedPageRef.current !== page?.pageIndex) return
          // 标记「同一页被父级 flush 回灌」跳过 updateScene，不影响切页
          skipSyncForPageRef.current = page.pageIndex
          onChangeRef.current?.(
            page.pageIndex,
            elements as readonly unknown[],
            appState as unknown as Record<string, unknown>
          )
        }}
        viewModeEnabled={isThumb}
        zenModeEnabled={isThumb}
        UIOptions={
          isThumb
            ? {
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: false,
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                  saveAsImage: false
                }
              }
            : undefined
        }
      />
    </div>
  )
}

export function MinimalPreview({
  projectId,
  projectName,
  onBackToEditor
}: MinimalPreviewProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'grid' | 'focus'>('grid')
  const [focusIndex, setFocusIndex] = useState(0)
  const [pages, setPages] = useState<PageSlide[]>([])
  const [slides, setSlides] = useState<Record<number, ExcalidrawPage>>({})
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  const [slideStatus, setSlideStatus] = useState<Record<number, 'queued' | 'streaming' | 'ready'>>(
    {}
  )
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  // 每页的重生成意见（focus 模式下可编辑）
  const [regenHints, setRegenHints] = useState<Record<number, string>>({})
  // focus 模式下意见面板是否展开
  const [hintExpanded, setHintExpanded] = useState(false)
  // 全局重生成意见（应用于“全部重生成”）
  const [allHint, setAllHint] = useState<string>('')
  const [allHintExpanded, setAllHintExpanded] = useState(false)

  const {
    exporting,
    progress: exportProgress,
    toast,
    exportPptx,
    exportExcalidraw,
    exportMarkdown,
    dismissToast
  } = useExport({ projectId, projectName, pages, slides })

  const generatingRef = useRef(false)

  // ---- focus 模式下用户手动编辑的持久化 ----
  // 缓冲当前正在 focus 的页 + 最新的 elements/appState；
  // 1s debounce 自动 flush；切换视图/页/重生成/导出前主动 flush。
  const editBufferRef = useRef<{
    pageIndex: number
    elements: unknown[]
    appState: Record<string, unknown>
  } | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 立即把缓冲区内容写入 slides state + DB（如果有未保存的修改） */
  const flushEdits = useCallback(async (): Promise<void> => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const buf = editBufferRef.current
    if (!buf) return
    editBufferRef.current = null

    const updated: ExcalidrawPage = {
      pageIndex: buf.pageIndex,
      elements: buf.elements,
      appState: { viewBackgroundColor: '#ffffff' }
    }
    // 同步父级状态：缩略图 / 导出 / 切回当前页都会用到这份新数据
    setSlides((prev) => ({ ...prev, [buf.pageIndex]: updated }))

    // 写回 DB：基于当前 excalidrawJson 增量替换该页
    try {
      const res = await window.api.projects.getContent(projectId)
      if (!res.success || !res.data) return
      let arr: ExcalidrawPage[] = []
      if (res.data.excalidrawJson) {
        try {
          arr = JSON.parse(res.data.excalidrawJson) as ExcalidrawPage[]
        } catch {
          arr = []
        }
      }
      const idx = arr.findIndex((p) => p.pageIndex === buf.pageIndex)
      if (idx >= 0) arr[idx] = updated
      else arr.push(updated)
      arr.sort((a, b) => a.pageIndex - b.pageIndex)
      await window.api.projects.upsertContent(projectId, {
        excalidrawJson: JSON.stringify(arr)
      })
    } catch {
      /* 忽略：下次 flush 会再次尝试 */
    }
  }, [projectId])

  /** Excalidraw onChange 回调：更新缓冲，重置 1s debounce 计时器 */
  const handleCanvasChange = useCallback(
    (pageIndex: number, elements: readonly unknown[], appState: Record<string, unknown>) => {
      editBufferRef.current = {
        pageIndex,
        elements: [...elements],
        appState
      }
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      flushTimerRef.current = setTimeout(() => {
        void flushEdits()
      }, 1000)
    },
    [flushEdits]
  )

  // 卸载前 flush（最后一次拖动可能还没到 1s）
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      // 卸载后无法 setState；这里只把 DB 写完即可
      const buf = editBufferRef.current
      if (!buf) return
      editBufferRef.current = null
      const updated: ExcalidrawPage = {
        pageIndex: buf.pageIndex,
        elements: buf.elements,
        appState: { viewBackgroundColor: '#ffffff' }
      }
      void (async () => {
        try {
          const res = await window.api.projects.getContent(projectId)
          if (!res.success || !res.data) return
          let arr: ExcalidrawPage[] = []
          if (res.data.excalidrawJson) {
            try {
              arr = JSON.parse(res.data.excalidrawJson) as ExcalidrawPage[]
            } catch {
              arr = []
            }
          }
          const idx = arr.findIndex((p) => p.pageIndex === buf.pageIndex)
          if (idx >= 0) arr[idx] = updated
          else arr.push(updated)
          arr.sort((a, b) => a.pageIndex - b.pageIndex)
          await window.api.projects.upsertContent(projectId, {
            excalidrawJson: JSON.stringify(arr)
          })
        } catch {
          /* ignore */
        }
      })()
    }
  }, [projectId])

  // 启动批量生成
  const runGenerateAll = useCallback(
    async (hint?: string) => {
      if (generatingRef.current) return
      // 生成前先把用户手动编辑落库，避免被新生成覆盖丢失
      await flushEdits()
      generatingRef.current = true
      setPhase('generating')
      setErrorMessage(null)
      const res = await window.api.llm.generateAllSlides(projectId, hint)
      generatingRef.current = false
      if (!res.success) {
        setErrorMessage(res.error || '生成幻灯片失败')
        setPhase('error')
        return
      }
      // 主进程告知「已在运行中」——保持 generating 状态，等 onSlideReady 事件推完后再转 ready
      if (res.data?.alreadyRunning) return
      setPhase('ready')
    },
    [projectId, flushEdits]
  )

  // 初始加载：读取 pagesJson + excalidrawJson
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setPhase('loading')
      const res = await window.api.projects.getContent(projectId)
      if (cancelled) return
      if (!res.success || !res.data) {
        setErrorMessage('无法读取项目内容')
        setPhase('error')
        return
      }
      const content = res.data
      if (!content.pagesJson) {
        setPhase('empty')
        return
      }
      let parsedPages: PageSlide[] = []
      try {
        parsedPages = JSON.parse(content.pagesJson) as PageSlide[]
      } catch {
        setErrorMessage('分页数据损坏')
        setPhase('error')
        return
      }
      setPages(parsedPages)

      let parsedSlides: ExcalidrawPage[] = []
      if (content.excalidrawJson) {
        try {
          parsedSlides = JSON.parse(content.excalidrawJson) as ExcalidrawPage[]
        } catch {
          parsedSlides = []
        }
      }
      const map: Record<number, ExcalidrawPage> = {}
      for (const s of parsedSlides) map[s.pageIndex] = s
      setSlides(map)

      // 无论是否全部生成，均进入 ready 状态。
      // 未生成的页面由 UI 显示「尚未生成」占位，用户手动点击重生成按钮触发。
      setPhase('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // 订阅单页就绪事件
  useEffect(() => {
    const unsubscribe = window.api.llm.onSlideReady(async (payload) => {
      if (payload.projectId !== projectId) return
      const res = await window.api.projects.getContent(projectId)
      if (!res.success || !res.data?.excalidrawJson) return
      try {
        const arr = JSON.parse(res.data.excalidrawJson) as ExcalidrawPage[]
        const found = arr.find((p) => p.pageIndex === payload.pageIndex)
        if (found) {
          setSlides((prev) => {
            const next = { ...prev, [payload.pageIndex]: found }
            // 所有页面都收到了，切换到 ready
            setPages((currentPages) => {
              if (currentPages.length > 0 && Object.keys(next).length >= currentPages.length) {
                setPhase('ready')
              }
              return currentPages
            })
            return next
          })
        }
      } catch {
        /* ignore */
      }
    })
    return unsubscribe
  }, [projectId])

  // 订阅每页状态变化（queued / streaming / ready）
  useEffect(() => {
    const unsubscribe = window.api.llm.onSlideStatus((payload) => {
      if (payload.projectId !== projectId) return
      setSlideStatus((prev) => ({ ...prev, [payload.pageIndex]: payload.status }))
    })
    return unsubscribe
  }, [projectId])

  // 单页重新生成
  const handleRegenerate = useCallback(
    async (pageIndex: number, hint?: string) => {
      // 如果该页有未保存的手动编辑先 flush（其他页缓冲也一并写下）
      await flushEdits()
      setRegeneratingIndex(pageIndex)
      const res = await window.api.llm.generateSlide(projectId, pageIndex, hint)
      setRegeneratingIndex(null)
      if (res.success && res.data) {
        setSlides((prev) => ({ ...prev, [pageIndex]: res.data! }))
        // 生成成功后清空该页意见并收起面板，避免过时意见影响下一次
        if (hint) {
          setRegenHints((prev) => {
            const n = { ...prev }
            delete n[pageIndex]
            return n
          })
          setHintExpanded(false)
        }
      }
    },
    [projectId, flushEdits]
  )

  // 切换页面时收起意见面板（flush 由切换包装函数同步完成）
  useEffect(() => {
    setHintExpanded(false)
  }, [focusIndex])

  /**
   * 切换 focus 页之前先 flush 当前页的未保存编辑，避免被新页 updateScene 后的
   * onChange 覆盖丢失。所有「切到某一页」入口都要走这个包装。
   */
  const switchToFocusPage = useCallback(
    async (idx: number): Promise<void> => {
      await flushEdits()
      setFocusIndex(idx)
    },
    [flushEdits]
  )

  /** 切换 grid / focus 视图前先 flush */
  const switchViewMode = useCallback(
    async (mode: 'grid' | 'focus'): Promise<void> => {
      await flushEdits()
      setViewMode(mode)
    },
    [flushEdits]
  )

  // ---- 渲染 ----

  if (phase === 'loading') {
    return (
      <div className="size-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (phase === 'empty') {
    return (
      <div className="size-full flex flex-col items-center justify-center gap-4 text-center px-8">
        <p className="text-gray-500">该项目还没有分页数据</p>
        <p className="text-sm text-gray-400">请先回到「编辑」页生成分页</p>
        {onBackToEditor && (
          <button
            onClick={onBackToEditor}
            className="mt-2 px-4 py-1.5 border border-gray-300 rounded-full text-sm hover:border-gray-900 transition-colors"
          >
            返回编辑
          </button>
        )}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="size-full flex flex-col items-center justify-center gap-4 text-center px-8">
        <p className="text-red-500">{errorMessage}</p>
        <button
          onClick={() => void runGenerateAll()}
          className="px-4 py-1.5 border border-gray-300 rounded-full text-sm hover:border-gray-900 transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  const generatedCount = Object.keys(slides).length

  return (
    <div className="size-full p-16 overflow-y-auto">
      <div className="max-w-7xl mx-auto h-full flex flex-col">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <h2 className="text-xl">演示预览</h2>
            <span className="px-2 py-1 rounded text-xs text-gray-500 bg-gray-100">
              {pages.length} 页
            </span>
            {phase === 'generating' && (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                生成中 {generatedCount} / {pages.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 border border-gray-200 rounded-full p-1">
              <button
                onClick={() => void switchViewMode('grid')}
                className={`p-1.5 rounded-full transition-all ${
                  viewMode === 'grid'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-400 hover:text-gray-900'
                }`}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => void switchViewMode('focus')}
                className={`p-1.5 rounded-full transition-all ${
                  viewMode === 'focus'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-400 hover:text-gray-900'
                }`}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <div className="flex items-center">
                <button
                  onClick={() => void runGenerateAll()}
                  disabled={phase === 'generating'}
                  title="让 AI 重新生成所有幻灯片"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {phase === 'generating' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  全部重生成
                </button>
                <button
                  onClick={() => setAllHintExpanded((v) => !v)}
                  disabled={phase === 'generating'}
                  title="附带修改意见"
                  aria-label="附带修改意见"
                  className={`p-1.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    allHintExpanded
                      ? 'text-gray-900 bg-gray-100'
                      : 'text-gray-400 hover:text-gray-900'
                  }`}
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
              </div>

              {allHintExpanded && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAllHintExpanded(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-3 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">
                        针对全部幻灯片的修改意见（可选）
                      </span>
                      <button
                        onClick={() => setAllHintExpanded(false)}
                        className="p-1 rounded text-gray-400 hover:text-gray-900 transition-colors"
                        aria-label="收起"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={allHint}
                      onChange={(e) => setAllHint(e.target.value)}
                      placeholder="例如：整体换暖色调 / 字号加大 / 多用图标少用文本…"
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded outline-none focus:border-gray-900 transition-colors resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={async () => {
                          const trimmed = allHint.trim()
                          if (!trimmed) return
                          setAllHintExpanded(false)
                          await runGenerateAll(trimmed)
                          setAllHint('')
                        }}
                        disabled={!allHint.trim() || phase === 'generating'}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-full text-sm hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        应用并重新生成
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 导出按钮 + 下拉菜单 */}
            <div className="relative flex items-stretch">
              <button
                onClick={async () => {
                  await flushEdits()
                  void exportPptx()
                }}
                disabled={exporting !== null || phase !== 'ready'}
                className="flex items-center gap-2 pl-4 pr-3 py-1.5 bg-gray-900 text-white rounded-l-full text-sm hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting === 'pptx' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {exporting === 'pptx' && exportProgress
                  ? `导出中 ${exportProgress.done}/${exportProgress.total}`
                  : '导出 PPT'}
              </button>
              <button
                onClick={() => setExportMenuOpen((v) => !v)}
                disabled={exporting !== null || phase !== 'ready'}
                aria-label="更多导出选项"
                className="flex items-center px-2 py-1.5 bg-gray-900 text-white rounded-r-full text-sm hover:bg-gray-800 transition-all border-l border-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronDown className="w-4 h-4" />
              </button>

              {exportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-60 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <button
                      onClick={async () => {
                        setExportMenuOpen(false)
                        await flushEdits()
                        void exportExcalidraw()
                      }}
                      disabled={exporting !== null}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FileJson className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-900">导出 Excalidraw 源文件</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          .excalidraw · 可在 excalidraw.com 继续编辑
                        </div>
                      </div>
                      {exporting === 'excalidraw' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                      )}
                    </button>
                    <div className="h-px bg-gray-100" />
                    <button
                      onClick={async () => {
                        setExportMenuOpen(false)
                        await flushEdits()
                        void exportMarkdown()
                      }}
                      disabled={exporting !== null}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FileText className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-900">导出 Markdown 演讲稿</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          .md · 包含演讲稿与幻灯片大纲
                        </div>
                      </div>
                      {exporting === 'markdown' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-6 pb-8">
            {pages.map((page, index) => {
              const slide = slides[index]
              const status = slideStatus[index]
              const isRegenerating = regeneratingIndex === index
              const isStreaming = status === 'streaming' || isRegenerating
              const isQueued = status === 'queued' && !isStreaming
              const showSlide = slide && !isStreaming && !isQueued
              return (
                <div
                  key={index}
                  className={`group relative border rounded-lg overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-500 ${
                    isStreaming
                      ? 'border-indigo-300 shadow-[0_0_0_4px_rgba(99,102,241,0.08)]'
                      : isQueued
                        ? 'border-gray-200 opacity-80'
                        : 'border-gray-200 hover:border-gray-900'
                  }`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* 编号 */}
                  <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-white/80 backdrop-blur border border-gray-200 flex items-center justify-center text-xs text-gray-500">
                    {index + 1}
                  </div>

                  {/* 重新生成按钮（常驻显示） */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRegenerate(index)
                    }}
                    disabled={isStreaming || isQueued}
                    title="重新生成此页"
                    className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-white/80 backdrop-blur border border-gray-200 text-gray-400 hover:text-gray-900 hover:border-gray-900 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isStreaming ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* 点击进入 focus */}
                  <button
                    onClick={async () => {
                      await flushEdits()
                      setFocusIndex(index)
                      setViewMode('focus')
                    }}
                    className="block w-full aspect-video text-left bg-white"
                  >
                    {showSlide ? (
                      <div className="size-full pointer-events-none relative">
                        <SlideCanvas page={slide} mode="thumbnail" />
                      </div>
                    ) : isStreaming ? (
                      <StreamingOverlay title={page.title} />
                    ) : isQueued ? (
                      <QueuedOverlay title={page.title} />
                    ) : (
                      <NotGeneratedOverlay />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* 大图预览 */}
            <div className="relative w-full max-w-4xl aspect-video border border-gray-200 rounded-lg mb-8 overflow-hidden animate-in zoom-in-95 duration-300 bg-white">
              {(() => {
                const status = slideStatus[focusIndex]
                const isRegenerating = regeneratingIndex === focusIndex
                const isStreaming = status === 'streaming' || isRegenerating
                const isQueued = status === 'queued' && !isStreaming
                const slide = slides[focusIndex]
                const title = pages[focusIndex]?.title ?? ''
                if (slide && !isStreaming && !isQueued) {
                  return (
                    <SlideCanvas
                      page={slide}
                      mode="focus"
                      onChange={(pageIndex, elements, appState) =>
                        handleCanvasChange(pageIndex, elements, appState)
                      }
                    />
                  )
                }
                return isStreaming ? (
                  <StreamingOverlay title={title} />
                ) : isQueued ? (
                  <QueuedOverlay title={title} />
                ) : (
                  <NotGeneratedOverlay />
                )
              })()}
              {/* 当前页重新生成 */}
              <button
                onClick={() => void handleRegenerate(focusIndex)}
                disabled={
                  regeneratingIndex === focusIndex ||
                  slideStatus[focusIndex] === 'streaming' ||
                  slideStatus[focusIndex] === 'queued'
                }
                title="重新生成此页"
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur border border-gray-200 text-sm text-gray-600 hover:text-gray-900 hover:border-gray-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {regeneratingIndex === focusIndex || slideStatus[focusIndex] === 'streaming' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                重新生成
              </button>
            </div>

            {/* 修改意见输入区（可选）— 折叠态显示一个轻量入口，展开后含 textarea + 应用按钮 */}
            <div className="w-full max-w-4xl mb-6">
              {!hintExpanded ? (
                <div className="flex justify-end">
                  <button
                    onClick={() => setHintExpanded(true)}
                    disabled={
                      regeneratingIndex === focusIndex ||
                      slideStatus[focusIndex] === 'streaming' ||
                      slideStatus[focusIndex] === 'queued'
                    }
                    className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <MessageSquarePlus className="w-4 h-4" />
                    添加修改意见
                  </button>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">针对这一页的修改意见（可选）</span>
                    <button
                      onClick={() => setHintExpanded(false)}
                      className="p-1 rounded text-gray-400 hover:text-gray-900 transition-colors"
                      aria-label="收起"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={regenHints[focusIndex] || ''}
                    onChange={(e) =>
                      setRegenHints((prev) => ({
                        ...prev,
                        [focusIndex]: e.target.value
                      }))
                    }
                    placeholder="例如：换暖色调 / 第 3 点改成图标 / 标题加大…"
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded outline-none focus:border-gray-900 transition-colors resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() =>
                        void handleRegenerate(
                          focusIndex,
                          (regenHints[focusIndex] || '').trim() || undefined
                        )
                      }
                      disabled={
                        !(regenHints[focusIndex] || '').trim() ||
                        regeneratingIndex === focusIndex ||
                        slideStatus[focusIndex] === 'streaming' ||
                        slideStatus[focusIndex] === 'queued'
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-full text-sm hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {regeneratingIndex === focusIndex ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      应用并重新生成
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 缩略图导航 */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {pages.map((_, index) => (
                <button
                  key={index}
                  onClick={() => void switchToFocusPage(index)}
                  className={`w-20 h-12 rounded border transition-all flex items-center justify-center text-xs ${
                    index === focusIndex
                      ? 'border-gray-900 scale-105 text-gray-900'
                      : 'border-gray-200 opacity-40 hover:opacity-100 text-gray-400'
                  }`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 导出 Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div
            className={`flex items-center gap-2 pl-4 pr-2 py-2 rounded-full shadow-lg backdrop-blur border text-sm ${
              toast.kind === 'success'
                ? 'bg-white/95 border-emerald-200 text-gray-900'
                : toast.kind === 'error'
                  ? 'bg-white/95 border-red-200 text-gray-900'
                  : 'bg-white/95 border-gray-200 text-gray-900'
            }`}
          >
            {toast.kind === 'success' ? (
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : toast.kind === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            ) : null}
            <span className="max-w-md truncate">{toast.text}</span>
            <button
              onClick={dismissToast}
              className="p-1 rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
