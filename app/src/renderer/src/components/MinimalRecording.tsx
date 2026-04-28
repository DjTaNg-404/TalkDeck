import { Mic, Pause, Check, Upload, FileText, X, AlertTriangle } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

interface MinimalRecordingProps {
  onComplete: () => void
  currentStep: number
  onStepChange: (step: number) => void
  projectId: number
  onOpenSettings: () => void
}

type InputMode = 'record' | 'audio' | 'text'
type RecordingState = 'idle' | 'recording' | 'paused'

export function MinimalRecording({
  onComplete,
  currentStep,
  onStepChange,
  projectId,
  onOpenSettings
}: MinimalRecordingProps): React.JSX.Element {
  const [inputMode, setInputMode] = useState<InputMode>('record')
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingTime, setRecordingTime] = useState(0)
  const [textContent, setTextContent] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [whisperReady, setWhisperReady] = useState<boolean | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // 组件挂载状态 + 流水线请求令牌：用户在转写过程中切换模式或离开时，
  // 防止后续 setState/onComplete 把界面强制拉回编辑页
  const mountedRef = useRef<boolean>(true)
  const pipelineTokenRef = useRef<number>(0)

  // MediaRecorder 相关
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // 录音计时器
  useEffect(() => {
    if (recordingState !== 'recording') return
    const interval = setInterval(() => {
      setRecordingTime((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [recordingState])

  // 进入录音页时检查 Whisper 状态
  useEffect(() => {
    let cancelled = false
    window.api.audio.getWhisperStatus().then((result) => {
      if (cancelled) return
      if (result.success && result.data) {
        setWhisperReady(result.data.ready)
      } else {
        setWhisperReady(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 清理定时器 + 释放麦克风
  useEffect(() => {
    return () => {
      mountedRef.current = false
      // 让任何尚未 await 完成的转写流水线被视为陈旧，回调将被忽略
      pipelineTokenRef.current += 1
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      // 卸载时也强制释放录音硬件
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        recorder.ondataavailable = null
        try {
          recorder.stop()
        } catch {
          /* ignore */
        }
      }
      mediaRecorderRef.current = null
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
  }, [])

  /**
   * 释放正在进行的录音硬件资源（recorder + 麦克风流 + 已采集的 chunks）。
   * 用于模式切换/卸载等场景：关闭录音状态，但不上传当前 buffer。
   */
  const abortRecordingHardware = (): void => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // 解绑回调，避免 stop 触发 onstop 里的上传逻辑
      recorder.onstop = null
      recorder.ondataavailable = null
      try {
        recorder.stop()
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []
  }

  const clearTimers = (): void => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  /**
   * 真实转写流水线：已有音频文件路径 → transcribe → onComplete。
   * 步骤 UI 只反映实际发生的两件事：转写中 → 完成。
   */
  const runTranscribePipeline = async (filePath: string): Promise<void> => {
    // 每次进入流水线递增 token，await 返回时若 token 已被覆盖 / 组件已卸载则丢弃结果
    const myToken = ++pipelineTokenRef.current
    setIsBusy(true)
    setErrorMessage(null)
    onStepChange(1) // 转写中

    const result = await window.api.audio.transcribe(projectId, filePath, 'auto')
    // 用户在转写期间切换了输入模式 / 离开了录音页：忽略这次结果，避免强制跳转回编辑页
    if (!mountedRef.current || pipelineTokenRef.current !== myToken) return
    if (!result.success) {
      setErrorMessage(result.error ?? '转写失败，请检查 Whisper 配置')
      setIsBusy(false)
      onStepChange(0)
      return
    }

    onStepChange(2) // 完成
    setIsBusy(false)
    onComplete()
  }

  // 录音模式处理
  const handleStartRecording = async (): Promise<void> => {
    setErrorMessage(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.start()
      setRecordingTime(0)
      setRecordingState('recording')
      onStepChange(0)
    } catch (err) {
      console.error('getUserMedia failed:', err)
      setErrorMessage('无法访问麦克风，请检查系统权限设置')
    }
  }

  const handlePauseRecording = (): void => {
    mediaRecorderRef.current?.pause()
    setRecordingState('paused')
  }

  const handleResumeRecording = (): void => {
    mediaRecorderRef.current?.resume()
    setRecordingState('recording')
  }

  const handleFinishRecording = (): void => {
    const recorder = mediaRecorderRef.current
    if (!recorder) {
      // 兜底：没有录音实例（异常情况），直接返回
      setRecordingState('idle')
      return
    }

    recorder.onstop = async () => {
      // 释放麦克风
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null

      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })

      setRecordingState('idle')

      if (blob.size === 0) {
        setErrorMessage('录音内容为空，请重试')
        return
      }

      // 上传 Blob 到主进程
      setIsBusy(true)
      setErrorMessage(null)
      onStepChange(1)

      const buffer = await blob.arrayBuffer()
      const saveResult = await window.api.audio.saveBlob(projectId, buffer)
      if (!saveResult.success || !saveResult.data) {
        setErrorMessage(saveResult.error ?? '保存录音失败')
        setIsBusy(false)
        onStepChange(0)
        return
      }

      await runTranscribePipeline(saveResult.data.filePath)
    }

    // 从 paused 直接 stop 也能正确触发 onstop
    recorder.stop()
  }

  // 上传模式处理
  const handleFileUpload = (): void => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    // 清空 input 以便同一文件可再次选择
    e.target.value = ''
    if (!file) return

    // Electron 39 已移除 File.path，走 preload 暴露的 webUtils.getPathForFile
    const filePath = window.api.audio.getPathForFile(file)
    if (!filePath) {
      setErrorMessage('无法获取文件路径，请重新选择')
      return
    }

    await runTranscribePipeline(filePath)
  }

  // 文本模式处理
  const handleTextSubmit = async (): Promise<void> => {
    const trimmed = textContent.trim()
    if (!trimmed) return

    clearTimers()
    setIsBusy(true)
    setErrorMessage(null)
    onStepChange(1) // 保存中（语义复用"转写中"这一格）

    const upsertResult = await window.api.projects.upsertContent(projectId, {
      rawTranscript: trimmed
    })
    if (!upsertResult.success) {
      setErrorMessage(upsertResult.error ?? '保存失败，请重试')
      setIsBusy(false)
      onStepChange(0)
      return
    }

    const stageResult = await window.api.projects.updateStage(projectId, 'editor')
    if (!stageResult.success) {
      setErrorMessage(stageResult.error ?? '更新项目状态失败')
      setIsBusy(false)
      onStepChange(0)
      return
    }

    onStepChange(2)
    setIsBusy(false)
    onComplete()
  }

  const modes = [
    { id: 'record' as InputMode, label: '录音', icon: Mic },
    { id: 'audio' as InputMode, label: '音频', icon: Upload },
    { id: 'text' as InputMode, label: '文本', icon: FileText }
  ]

  return (
    <div className="size-full flex flex-col items-center justify-center">
      {/* 输入模式切换 */}
      <div
        className={`absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-8 transition-opacity ${
          isBusy ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              if (mode.id === inputMode) return
              // 切换模式前释放录音硬件，避免后台继续录音
              abortRecordingHardware()
              setInputMode(mode.id)
              setRecordingState('idle')
              setRecordingTime(0)
            }}
            disabled={isBusy}
            className={`flex items-center gap-2 transition-all ${
              inputMode === mode.id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <mode.icon className="w-4 h-4" />
            <span className="text-sm">{mode.label}</span>
            {inputMode === mode.id && <div className="w-1 h-1 rounded-full bg-gray-900 ml-1"></div>}
          </button>
        ))}
      </div>

      {/* 处理步骤指示 */}
      {currentStep > 0 && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 flex items-center gap-6">
          {['转写中', '完成'].map((label, index) => (
            <div
              key={label}
              className={`flex items-center gap-2 text-sm transition-all ${
                index === currentStep - 1
                  ? 'text-gray-900'
                  : index < currentStep - 1
                    ? 'text-gray-400'
                    : 'text-gray-300'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  index === currentStep - 1
                    ? 'bg-gray-900'
                    : index < currentStep - 1
                      ? 'bg-gray-400'
                      : 'bg-gray-200'
                }`}
              ></div>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* 录音模式 */}
      {inputMode === 'record' && (
        <div className="flex flex-col items-center">
          {/* 主控制按钮 */}
          <div className="mb-12">
            <button
              onClick={
                recordingState === 'idle'
                  ? handleStartRecording
                  : recordingState === 'recording'
                    ? handlePauseRecording
                    : handleResumeRecording
              }
              disabled={isBusy}
              className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                recordingState === 'recording'
                  ? 'bg-gray-900 text-white scale-110 shadow-lg'
                  : recordingState === 'paused'
                    ? 'bg-gray-700 text-white scale-105'
                    : 'bg-white border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white hover:scale-105'
              }`}
            >
              {recordingState === 'idle' && <Mic className="w-10 h-10" />}
              {recordingState === 'recording' && <Pause className="w-10 h-10" />}
              {recordingState === 'paused' && <Mic className="w-10 h-10" />}

              {/* 录音中的脉动效果 */}
              {recordingState === 'recording' && (
                <div className="absolute inset-0 rounded-full border-2 border-gray-900 animate-ping opacity-20"></div>
              )}
            </button>

            {/* 时间显示 */}
            {recordingState !== 'idle' && (
              <div className="mt-6 text-center">
                <div className="text-3xl font-mono font-light tabular-nums text-gray-900">
                  {Math.floor(recordingTime / 60)}:
                  {(recordingTime % 60).toString().padStart(2, '0')}
                </div>
              </div>
            )}
          </div>

          {/* 状态提示 */}
          <div className="text-center mb-8">
            {recordingState === 'idle' && <p className="text-gray-500">点击开始录制</p>}
            {recordingState === 'recording' && <p className="text-gray-900">录制中，点击暂停</p>}
            {recordingState === 'paused' && <p className="text-gray-700">已暂停，点击继续</p>}
          </div>

          {/* 完成按钮 */}
          {recordingState !== 'idle' && (
            <button
              onClick={handleFinishRecording}
              disabled={isBusy}
              className="px-8 py-3 rounded-full border border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              完成录制
            </button>
          )}
        </div>
      )}

      {/* 上传音频模式 */}
      {inputMode === 'audio' && (
        <div className="w-full max-w-lg">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={handleFileUpload}
            disabled={isBusy}
            className="w-full aspect-video border-2 border-dashed border-gray-300 rounded-3xl hover:border-gray-900 transition-all flex flex-col items-center justify-center gap-4 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-20 h-20 rounded-full bg-gray-100 group-hover:bg-gray-900 flex items-center justify-center transition-all">
              <Upload className="w-10 h-10 text-gray-400 group-hover:text-white transition-all" />
            </div>
            <div className="text-center">
              <p className="text-gray-900 mb-1">点击上传音频文件</p>
              <p className="text-sm text-gray-500">支持 MP3、WAV、M4A 格式</p>
            </div>
          </button>
        </div>
      )}

      {/* 文本输入模式 */}
      {inputMode === 'text' && (
        <div className="w-full max-w-2xl">
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            disabled={isBusy}
            placeholder="在此输入或粘贴演讲文本内容..."
            className="w-full h-80 p-8 border border-gray-300 rounded-3xl resize-none focus:outline-none focus:border-gray-900 transition-all text-gray-900 placeholder:text-gray-400 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setTextContent('')}
              disabled={isBusy}
              className="px-6 py-2.5 text-gray-500 hover:text-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清空
            </button>
            <button
              onClick={handleTextSubmit}
              disabled={!textContent.trim() || isBusy}
              className="px-8 py-2.5 rounded-full bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
            >
              下一步
            </button>
          </div>
        </div>
      )}

      {/* Whisper 未就绪引导横幅 */}
      {whisperReady === false && inputMode !== 'text' && (
        <div className="absolute top-40 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-5 py-2.5 rounded-full shadow-sm">
          <AlertTriangle className="w-4 h-4" />
          <span>Whisper 尚未就绪，无法转写音频</span>
          <button
            onClick={onOpenSettings}
            className="ml-1 px-3 py-1 rounded-full bg-amber-600 text-white text-xs hover:bg-amber-700 transition-colors"
          >
            前往设置
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {errorMessage && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-6 py-3 rounded-full">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-700 transition-all"
            aria-label="关闭错误提示"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
