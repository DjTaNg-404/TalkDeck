import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowRight, RefreshCw, Loader2, X, MessageSquarePlus, Sparkles } from 'lucide-react'
import type { PageSlide } from '../../../shared/types'

interface MinimalEditorProps {
  projectId: number
  onNext: () => void
}

type Phase = 'loading' | 'arranging' | 'generating' | 'ready' | 'error'

export function MinimalEditor({ projectId, onNext }: MinimalEditorProps): React.JSX.Element {
  const [script, setScript] = useState<string>('')
  const [pages, setPages] = useState<PageSlide[]>([])
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // \u91cd\u65b0\u5206\u9875\u610f\u89c1\uff08\u53ef\u9009\uff0c\u6210\u529f\u540e\u6e05\u7a7a\uff09
  const [pagesHint, setPagesHint] = useState<string>('')
  const [pagesHintExpanded, setPagesHintExpanded] = useState<boolean>(false)

  // 用 ref 避免 closure 中拿到旧值
  const scriptRef = useRef<string>('')

  // 已落库的 script 内容，用于判断用户编辑后是否需要重新分页
  const lastSavedScriptRef = useRef<string>('')

  // ---- 保存草稿到 DB（blur 时调用） ----
  const saveScriptDraft = useCallback(async () => {
    if (!scriptRef.current) return
    if (scriptRef.current === lastSavedScriptRef.current) return
    await window.api.projects.upsertContent(projectId, { script: scriptRef.current })
    lastSavedScriptRef.current = scriptRef.current
  }, [projectId])

  // ---- 生成分页 ----
  const runGeneratePages = useCallback(
    async (hint?: string): Promise<boolean> => {
      // 用户可能编辑后未触发 blur 就直接点了"重新分页"，先把最新草稿落库，
      // 否则后端读到的还是上一次保存的旧 script
      const current = scriptRef.current
      if (current.trim() && current !== lastSavedScriptRef.current) {
        await window.api.projects.upsertContent(projectId, { script: current })
        lastSavedScriptRef.current = current
      }
      setPhase('generating')
      const res = await window.api.llm.generatePages(projectId, hint)
      if (!res.success || !res.data) {
        setErrorMessage(res.error || '生成分页失败')
        setPhase('error')
        return false
      }
      setPages(res.data)
      setPhase('ready')
      return true
    },
    [projectId]
  )

  // ---- 流式整理演讲稿 ----
  const runArrangeScript = useCallback(async (): Promise<boolean> => {
    setErrorMessage(null)
    setScript('')
    scriptRef.current = ''
    setPhase('arranging')

    const unsubscribe = window.api.llm.onStreamChunk((payload) => {
      if (payload.projectId !== projectId) return
      setScript((prev) => {
        const next = prev + payload.delta
        scriptRef.current = next
        return next
      })
    })

    try {
      const res = await window.api.llm.streamArrangeScript(projectId)
      if (!res.success || !res.data) {
        setErrorMessage(res.error || '整理演讲稿失败')
        setPhase('error')
        return false
      }
      // 用完整文本覆盖，确保最终内容完整
      setScript(res.data)
      scriptRef.current = res.data
      lastSavedScriptRef.current = res.data
      return true
    } finally {
      unsubscribe()
    }
  }, [projectId])

  // ---- 完整流水线：整理 → 分页 ----
  const runFullPipeline = useCallback(async () => {
    const ok = await runArrangeScript()
    if (ok) await runGeneratePages()
  }, [runArrangeScript, runGeneratePages])

  // ---- 首次加载 ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await window.api.projects.getContent(projectId)
      if (cancelled) return
      const content = res.success ? res.data : null

      const existingScript = content?.script?.trim() || ''
      const existingPagesJson = content?.pagesJson?.trim() || ''

      if (existingScript && existingPagesJson) {
        try {
          const parsed = JSON.parse(existingPagesJson) as PageSlide[]
          setScript(existingScript)
          scriptRef.current = existingScript
          lastSavedScriptRef.current = existingScript
          setPages(parsed)
          setPhase('ready')
          return
        } catch {
          // 解析失败，走重新生成分页
        }
      }

      if (existingScript) {
        setScript(existingScript)
        scriptRef.current = existingScript
        lastSavedScriptRef.current = existingScript
        await runGeneratePages()
        return
      }

      const rawTranscript = content?.rawTranscript?.trim() || ''
      if (!rawTranscript) {
        setErrorMessage('没有可用的转写文本，请返回上一步重新录音')
        setPhase('error')
        return
      }

      await runFullPipeline()
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, runFullPipeline, runGeneratePages])

  const isBusy = phase === 'loading' || phase === 'arranging' || phase === 'generating'
  const canGoNext = phase === 'ready' && pages.length > 0

  // 进入下一步前：若用户改过演讲稿，先保存并基于最新文本重新分页
  const handleNext = useCallback(async () => {
    const current = scriptRef.current
    if (current.trim() && current !== lastSavedScriptRef.current) {
      await window.api.projects.upsertContent(projectId, { script: current })
      lastSavedScriptRef.current = current
      const ok = await runGeneratePages()
      if (!ok) return
    }
    onNext()
  }, [projectId, runGeneratePages, onNext])

  return (
    <div className="size-full p-16 overflow-hidden">
      <div className="max-w-7xl mx-auto h-full grid grid-cols-2 gap-12 min-h-0">
        {/* 左侧：演讲稿 */}
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl">演讲稿</h2>
            <button
              onClick={runFullPipeline}
              disabled={isBusy}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {phase === 'arranging' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              重新整理
            </button>
          </div>

          <div className="flex-1 min-h-0 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            {phase === 'arranging' && script.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                正在整理演讲稿…
              </div>
            ) : (
              <textarea
                value={script}
                onChange={(e) => {
                  scriptRef.current = e.target.value
                  setScript(e.target.value)
                }}
                onBlur={saveScriptDraft}
                readOnly={phase === 'arranging'}
                placeholder={phase === 'loading' ? '加载中…' : '演讲稿将在这里显示，可直接编辑'}
                className="flex-1 w-full p-8 text-gray-600 leading-relaxed resize-none outline-none bg-transparent"
              />
            )}
          </div>
        </div>

        {/* 右侧：自动分页 */}
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl">智能分页</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void runGeneratePages()}
                disabled={isBusy || !script.trim()}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="基于当前演讲稿重新分页"
              >
                {phase === 'generating' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                重新分页
              </button>
              <button
                onClick={() => void handleNext()}
                disabled={!canGoNext}
                className="flex items-center gap-2 px-4 py-1.5 bg-gray-900 text-white rounded-full text-sm hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                生成页面
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 重新分页修改意见折叠区 */}
          {!pagesHintExpanded ? (
            <div className="flex justify-end -mt-3 mb-3">
              <button
                onClick={() => setPagesHintExpanded(true)}
                disabled={isBusy || !script.trim()}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                添加分页意见
              </button>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mb-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">针对分页的修改意见（可选）</span>
                <button
                  onClick={() => setPagesHintExpanded(false)}
                  className="p-1 rounded text-gray-400 hover:text-gray-900 transition-colors"
                  aria-label="收起"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={pagesHint}
                onChange={(e) => setPagesHint(e.target.value)}
                placeholder="例如：分成 6 页 / 开头加一页封面 / 把案例单独成页…"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded outline-none focus:border-gray-900 transition-colors resize-none"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={async () => {
                    const trimmed = pagesHint.trim()
                    if (!trimmed) return
                    const ok = await runGeneratePages(trimmed)
                    if (ok) {
                      setPagesHint('')
                      setPagesHintExpanded(false)
                    }
                  }}
                  disabled={!pagesHint.trim() || isBusy || !script.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-full text-sm hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {phase === 'generating' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  应用并重新分页
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-2 pb-4">
            {phase === 'generating' &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-5 animate-pulse">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200" />
                    <div className="flex-1 space-y-3">
                      <div className="h-4 bg-gray-200 rounded w-1/2" />
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-2/3" />
                    </div>
                  </div>
                </div>
              ))}

            {phase !== 'generating' &&
              pages.map((page, index) => (
                <div
                  key={index}
                  className="border border-gray-200 rounded-lg p-5 hover:border-gray-900 transition-all cursor-pointer animate-in fade-in slide-in-from-right-2 duration-500"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="mb-3">{page.title}</h3>
                      <ul className="space-y-1.5 mb-3">
                        {page.points.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                            <span className="text-gray-300">•</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                      {page.summary && (
                        <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-3">
                          {page.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

            {phase === 'ready' && pages.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-12">暂无分页结果</div>
            )}
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-full shadow-sm">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
