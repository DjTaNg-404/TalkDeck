import { useCallback, useRef, useState } from 'react'
import type { ExcalidrawPage, PageSlide } from '../../../shared/types'
import { exportAllPagesToPng } from '../lib/slideExport'

type ExportFormat = 'pptx' | 'excalidraw' | 'markdown'

interface ToastMessage {
  kind: 'success' | 'error' | 'info'
  text: string
  id: number
}

interface UseExportOptions {
  projectId: number
  projectName: string
  pages: PageSlide[]
  /** pageIndex -> ExcalidrawPage */
  slides: Record<number, ExcalidrawPage>
}

interface UseExportResult {
  exporting: ExportFormat | null
  progress: { done: number; total: number } | null
  toast: ToastMessage | null
  exportPptx: () => Promise<void>
  exportExcalidraw: () => Promise<void>
  exportMarkdown: () => Promise<void>
  dismissToast: () => void
}

const sanitizeFileName = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名'

export function useExport(opts: UseExportOptions): UseExportResult {
  const { projectId, projectName, pages, slides } = opts
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((kind: ToastMessage['kind'], text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ kind, text, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const exportPptx = useCallback(async () => {
    if (exporting) return
    if (pages.length === 0) {
      showToast('error', '没有可导出的幻灯片')
      return
    }
    const orderedSlides: ExcalidrawPage[] = []
    for (let i = 0; i < pages.length; i++) {
      const s = slides[i]
      if (!s) {
        showToast('error', `第 ${i + 1} 页还未生成完成`)
        return
      }
      orderedSlides.push(s)
    }

    const safeName = sanitizeFileName(projectName)
    const saveRes = await window.api.dialog.saveFile({
      title: '导出 PPT',
      defaultPath: `${safeName}.pptx`,
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    })
    if (!saveRes.success || !saveRes.data?.filePath) return
    const filePath = saveRes.data.filePath

    setExporting('pptx')
    setProgress({ done: 0, total: pages.length })
    try {
      const pngs = await exportAllPagesToPng(orderedSlides, (done, total) => {
        setProgress({ done, total })
      })
      const slidePayload = pngs.map((buf, i) => ({
        pngBuffer: Array.from(buf),
        title: pages[i]?.title ?? `第 ${i + 1} 页`
      }))
      const res = await window.api.export.toPptx({
        filePath,
        title: projectName,
        slides: slidePayload
      })
      if (res.success) {
        showToast('success', `已导出 ${filePath}`)
      } else {
        showToast('error', res.error || '导出失败')
      }
    } catch (e) {
      showToast('error', (e as Error).message || '导出失败')
    } finally {
      setExporting(null)
      setProgress(null)
    }
  }, [exporting, pages, slides, projectName, showToast])

  const exportExcalidraw = useCallback(async () => {
    if (exporting) return
    const safeName = sanitizeFileName(projectName)
    const saveRes = await window.api.dialog.saveFile({
      title: '导出 Excalidraw 源文件',
      defaultPath: `${safeName}.excalidraw`,
      filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }]
    })
    if (!saveRes.success || !saveRes.data?.filePath) return

    setExporting('excalidraw')
    try {
      const res = await window.api.export.toExcalidraw({
        filePath: saveRes.data.filePath,
        projectId
      })
      if (res.success) {
        showToast('success', `已导出 ${saveRes.data.filePath}`)
      } else {
        showToast('error', res.error || '导出失败')
      }
    } finally {
      setExporting(null)
    }
  }, [exporting, projectId, projectName, showToast])

  const exportMarkdown = useCallback(async () => {
    if (exporting) return
    const safeName = sanitizeFileName(projectName)
    const saveRes = await window.api.dialog.saveFile({
      title: '导出 Markdown 演讲稿',
      defaultPath: `${safeName}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (!saveRes.success || !saveRes.data?.filePath) return

    setExporting('markdown')
    try {
      const res = await window.api.export.toMarkdown({
        filePath: saveRes.data.filePath,
        projectId
      })
      if (res.success) {
        showToast('success', `已导出 ${saveRes.data.filePath}`)
      } else {
        showToast('error', res.error || '导出失败')
      }
    } finally {
      setExporting(null)
    }
  }, [exporting, projectId, projectName, showToast])

  return {
    exporting,
    progress,
    toast,
    exportPptx,
    exportExcalidraw,
    exportMarkdown,
    dismissToast
  }
}
