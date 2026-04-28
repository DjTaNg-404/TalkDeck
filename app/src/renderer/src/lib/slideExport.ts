import { exportToBlob } from '@excalidraw/excalidraw'
import type { ExcalidrawPage } from '../../../shared/types'

/** 输出 PNG 的目标尺寸（2x 16:9，清晰） */
export const SLIDE_EXPORT_WIDTH = 2560
export const SLIDE_EXPORT_HEIGHT = 1440

/**
 * 将单页 Excalidraw elements 渲染为 PNG 的 Uint8Array。
 * IPC 不支持 TypedArray，调用方需自行 `Array.from(...)` 再发送。
 */
export async function exportPageToPng(page: ExcalidrawPage): Promise<Uint8Array> {
  const blob = await exportToBlob({
    elements: page.elements as never,
    appState: {
      ...(page.appState ?? {}),
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: '#ffffff'
    } as never,
    files: null,
    mimeType: 'image/png',
    getDimensions: () => ({
      width: SLIDE_EXPORT_WIDTH,
      height: SLIDE_EXPORT_HEIGHT,
      scale: 2
    })
  })
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * 批量导出所有页面为 PNG。
 * onProgress 在每页完成后触发，便于上层显示进度。
 */
export async function exportAllPagesToPng(
  pages: ExcalidrawPage[],
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = []
  for (let i = 0; i < pages.length; i++) {
    const png = await exportPageToPng(pages[i])
    results.push(png)
    onProgress?.(i + 1, pages.length)
  }
  return results
}
