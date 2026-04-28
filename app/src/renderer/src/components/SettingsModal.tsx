import { useState, useEffect, useCallback } from 'react'
import { X, FolderOpen, CheckCircle2, AlertCircle } from 'lucide-react'
import type { Settings } from '../../../shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const defaultSettings: Settings = {
  llmApiBaseUrl: 'https://api.openai.com/v1',
  llmApiKey: '',
  llmModel: 'gpt-4o',
  whisperModelPath: '',
  whisperCliPath: '',
  language: 'auto'
}

interface WhisperStatus {
  ready: boolean
  message: string
}

export function SettingsModal({ open, onClose }: SettingsModalProps): React.JSX.Element | null {
  const [form, setForm] = useState<Settings>(defaultSettings)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null)

  const refreshWhisperStatus = useCallback(async () => {
    const result = await window.api.audio.getWhisperStatus()
    if (result.success && result.data) {
      setWhisperStatus(result.data)
    } else {
      setWhisperStatus({ ready: false, message: result.error ?? 'Whisper 状态检查失败' })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setSaveError(null)
    window.api.settings.get().then((result) => {
      if (result.success && result.data) {
        setForm(result.data)
      }
    })
    refreshWhisperStatus()
  }, [open, refreshWhisperStatus])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    // 简单校验：baseUrl 必须是 http(s) 合法 URL，避免到 LLM 调用时才报错
    const trimmed = form.llmApiBaseUrl.trim()
    if (trimmed) {
      try {
        const u = new URL(trimmed)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setSaveError('LLM API Base URL 必须以 http:// 或 https:// 开头')
          return
        }
      } catch {
        setSaveError('LLM API Base URL 格式不合法，请检查')
        return
      }
    }

    setSaving(true)
    setSaveError(null)
    const res = await window.api.settings.set(form)
    if (!res.success) {
      setSaveError(res.error ?? '保存失败，请重试')
      setSaving(false)
      return
    }
    await refreshWhisperStatus()
    setSaving(false)
    onClose()
  }, [form, onClose, refreshWhisperStatus])

  const pickModelFile = useCallback(async () => {
    const result = await window.api.dialog.openFile({
      title: '选择 Whisper 模型文件',
      filters: [{ name: 'Whisper Model', extensions: ['bin', 'ggml'] }]
    })
    if (result.success && result.data?.filePath) {
      update('whisperModelPath', result.data.filePath)
    }
  }, [update])

  const pickCliFile = useCallback(async () => {
    const result = await window.api.dialog.openFile({
      title: '选择 whisper-cli 可执行文件'
    })
    if (result.success && result.data?.filePath) {
      update('whisperCliPath', result.data.filePath)
    }
  }, [update])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-8 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          aria-label="关闭设置"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 id="settings-modal-title" className="text-xl font-medium mb-6">
          设置
        </h2>

        <div className="space-y-5">
          {/* LLM API Base URL */}
          <div>
            <label className="block text-sm text-gray-500 mb-1.5">LLM API Base URL</label>
            <input
              type="text"
              value={form.llmApiBaseUrl}
              onChange={(e) => update('llmApiBaseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors"
            />
          </div>

          {/* LLM API Key */}
          <div>
            <label className="block text-sm text-gray-500 mb-1.5">LLM API Key</label>
            <input
              type="password"
              value={form.llmApiKey}
              onChange={(e) => update('llmApiKey', e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors"
            />
          </div>

          {/* 模型名称 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1.5">模型名称</label>
            <input
              type="text"
              value={form.llmModel}
              onChange={(e) => update('llmModel', e.target.value)}
              placeholder="gpt-4o"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors"
            />
          </div>

          {/* Whisper 分节 */}
          <div className="pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Whisper 本地转写</h3>
              {whisperStatus && (
                <div
                  className={`flex items-center gap-1.5 text-xs ${
                    whisperStatus.ready ? 'text-green-600' : 'text-amber-600'
                  }`}
                >
                  {whisperStatus.ready ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  <span>{whisperStatus.ready ? '已就绪' : '未就绪'}</span>
                </div>
              )}
            </div>
            {whisperStatus && !whisperStatus.ready && (
              <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 whitespace-pre-line">
                {whisperStatus.message}
              </p>
            )}

            {/* Whisper 模型路径 */}
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1.5">模型文件路径</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.whisperModelPath}
                  onChange={(e) => update('whisperModelPath', e.target.value)}
                  placeholder="留空则自动使用 whisper/models/ 下的第一个模型"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors"
                />
                <button
                  onClick={pickModelFile}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-900 hover:border-gray-900 transition-colors"
                  aria-label="选择模型文件"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* whisper-cli 路径 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">whisper-cli 路径</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.whisperCliPath}
                  onChange={(e) => update('whisperCliPath', e.target.value)}
                  placeholder="留空则使用 whisper/bin/whisper-cli"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors"
                />
                <button
                  onClick={pickCliFile}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-900 hover:border-gray-900 transition-colors"
                  aria-label="选择 whisper-cli 可执行文件"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 语言选择 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1.5">语言</label>
            <select
              value={form.language}
              onChange={(e) => update('language', e.target.value as Settings['language'])}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-900 transition-colors bg-white"
            >
              <option value="auto">自动检测</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {/* 保存按钮 */}
        {saveError && (
          <p className="mt-6 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">
            {saveError}
          </p>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-8 w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
