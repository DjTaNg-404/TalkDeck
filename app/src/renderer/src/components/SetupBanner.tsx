import { useEffect, useState } from 'react'
import { AlertTriangle, Settings as SettingsIcon, ArrowRight } from 'lucide-react'

interface SetupBannerProps {
  onOpenSettings: () => void
}

interface SetupState {
  apiKeyMissing: boolean
  whisperNotReady: boolean
  checked: boolean
}

/**
 * 首次运行引导条：检测 LLM API Key 是否配置、Whisper 是否就绪。
 * 任一未满足时在首页顶部显示橙色提示，点击即可打开设置。
 */
export function SetupBanner({ onOpenSettings }: SetupBannerProps): React.JSX.Element | null {
  const [state, setState] = useState<SetupState>({
    apiKeyMissing: false,
    whisperNotReady: false,
    checked: false
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settingsRes, whisperRes] = await Promise.all([
        window.api.settings.get(),
        window.api.audio.getWhisperStatus()
      ])
      if (cancelled) return
      const apiKeyMissing = !settingsRes.success || !settingsRes.data?.llmApiKey?.trim()
      const whisperNotReady = !whisperRes.success || !whisperRes.data?.ready
      setState({ apiKeyMissing, whisperNotReady, checked: true })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!state.checked) return null
  if (!state.apiKeyMissing && !state.whisperNotReady) return null

  const items: string[] = []
  if (state.apiKeyMissing) items.push('LLM API Key 未设置')
  if (state.whisperNotReady) items.push('Whisper 未就绪')

  return (
    <button
      onClick={onOpenSettings}
      className="w-full mb-6 flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors text-left animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-amber-900">首次使用需完成配置</div>
        <div className="text-xs text-amber-700/80 mt-0.5 truncate">{items.join(' · ')}</div>
      </div>
      <div className="flex items-center gap-1.5 text-sm text-amber-900 shrink-0">
        <SettingsIcon className="w-3.5 h-3.5" />
        打开设置
        <ArrowRight className="w-3.5 h-3.5" />
      </div>
    </button>
  )
}
