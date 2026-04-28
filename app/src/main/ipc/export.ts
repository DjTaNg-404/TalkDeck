import { ipcMain } from 'electron'
import fs from 'node:fs'
import PptxGenJS from 'pptxgenjs'
import type { IpcResult, ExcalidrawPage, PageSlide } from '../../shared/types'
import { getContent } from '../db/contents'
import { getProjectById } from '../db/projects'

interface PptxSlidePayload {
  /** Uint8Array 被序列化为 number[] 通过 IPC 传递 */
  pngBuffer: number[]
  title: string
}

interface ToPptxPayload {
  filePath: string
  title: string
  slides: PptxSlidePayload[]
}

export function registerExportHandlers(): void {
  /**
   * 将渲染好的每页 PNG 合成 pptx 文件写入 filePath。
   * 每页占满 16:9 版心，图片居中 100% 铺满。
   */
  ipcMain.handle(
    'export:toPptx',
    async (_event, payload: ToPptxPayload): Promise<IpcResult<{ filePath: string }>> => {
      try {
        if (!payload.filePath) {
          return { success: false, error: '缺少保存路径' }
        }
        if (!Array.isArray(payload.slides) || payload.slides.length === 0) {
          return { success: false, error: '没有可导出的幻灯片' }
        }

        const pptx = new PptxGenJS()
        pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 英寸，16:9
        pptx.title = payload.title || 'TalkDeck'

        for (const s of payload.slides) {
          const slide = pptx.addSlide()
          if (!s.pngBuffer || s.pngBuffer.length === 0) {
            // 某页缺图时至少写个标题，避免空页报错
            slide.addText(s.title || '', {
              x: 0.5,
              y: 3,
              w: 12.3,
              h: 1.5,
              fontSize: 32,
              align: 'center'
            })
            continue
          }
          const buf = Buffer.from(s.pngBuffer)
          const base64 = buf.toString('base64')
          slide.addImage({
            data: `data:image/png;base64,${base64}`,
            x: 0,
            y: 0,
            w: '100%',
            h: '100%'
          })
        }

        await pptx.writeFile({ fileName: payload.filePath })
        return { success: true, data: { filePath: payload.filePath } }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )

  /**
   * 将项目所有页 Excalidraw elements 合并到单个 .excalidraw 文件。
   * 按 pageIndex 纵向偏移（每页 +800px），便于在 excalidraw.com 里
   * 像 Figma 画框那样逐页查看/编辑。
   */
  ipcMain.handle(
    'export:toExcalidraw',
    async (
      _event,
      payload: { filePath: string; projectId: number }
    ): Promise<IpcResult<{ filePath: string }>> => {
      try {
        if (!payload.filePath) {
          return { success: false, error: '缺少保存路径' }
        }
        const content = getContent(payload.projectId)
        const raw = content?.excalidrawJson
        if (!raw) {
          return { success: false, error: '该项目还没有生成幻灯片' }
        }
        let pages: ExcalidrawPage[]
        try {
          pages = JSON.parse(raw) as ExcalidrawPage[]
        } catch {
          return { success: false, error: '幻灯片数据损坏，无法解析' }
        }
        if (!Array.isArray(pages) || pages.length === 0) {
          return { success: false, error: '没有可导出的幻灯片' }
        }

        const PAGE_OFFSET_Y = 800
        const allElements = pages
          .slice()
          .sort((a, b) => a.pageIndex - b.pageIndex)
          .flatMap((page) =>
            (page.elements as Record<string, unknown>[]).map((el) => ({
              ...el,
              y:
                typeof el.y === 'number'
                  ? el.y + page.pageIndex * PAGE_OFFSET_Y
                  : page.pageIndex * PAGE_OFFSET_Y
            }))
          )

        const excalidrawFile = {
          type: 'excalidraw',
          version: 2,
          source: 'TalkDeck',
          elements: allElements,
          appState: { viewBackgroundColor: '#ffffff', gridSize: null },
          files: {}
        }

        fs.writeFileSync(payload.filePath, JSON.stringify(excalidrawFile, null, 2), 'utf-8')
        return { success: true, data: { filePath: payload.filePath } }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )

  /**
   * 将演讲稿 + 幻灯片大纲导出为 Markdown 文件。
   */
  ipcMain.handle(
    'export:toMarkdown',
    async (
      _event,
      payload: { filePath: string; projectId: number }
    ): Promise<IpcResult<{ filePath: string }>> => {
      try {
        if (!payload.filePath) {
          return { success: false, error: '缺少保存路径' }
        }
        const project = getProjectById(payload.projectId)
        const content = getContent(payload.projectId)
        if (!content) {
          return { success: false, error: '项目内容不存在' }
        }

        let pages: PageSlide[] = []
        if (content.pagesJson) {
          try {
            pages = JSON.parse(content.pagesJson) as PageSlide[]
          } catch {
            /* ignore */
          }
        }

        const lines: string[] = []
        lines.push(`# ${project?.name ?? '演讲稿'}`, '')

        const script = content.script?.trim()
        if (script) {
          lines.push('## 演讲稿', '', script, '')
        }

        if (pages.length > 0) {
          lines.push('## 幻灯片大纲', '')
          pages.forEach((page, i) => {
            lines.push(`### 第 ${i + 1} 页 · ${page.title}`, '')
            for (const point of page.points) {
              lines.push(`- ${point}`)
            }
            if (page.summary) {
              lines.push('', `> ${page.summary}`)
            }
            lines.push('')
          })
        }

        fs.writeFileSync(payload.filePath, lines.join('\n'), 'utf-8')
        return { success: true, data: { filePath: payload.filePath } }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )
}
