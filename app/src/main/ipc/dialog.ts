import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { IpcResult } from '../../shared/types'

interface OpenFileOptions {
  title?: string
  /** 文件过滤器，如 `[{ name: 'Whisper 模型', extensions: ['bin'] }]` */
  filters?: Electron.FileFilter[]
}

interface OpenFileResult {
  /** 用户取消则为 null */
  filePath: string | null
}

interface SaveFileOptions {
  title?: string
  defaultPath?: string
  filters?: Electron.FileFilter[]
}

interface SaveFileResult {
  /** 用户取消则为 null */
  filePath: string | null
}

export function registerDialogHandlers(): void {
  ipcMain.handle(
    'dialog:openFile',
    async (event, options: OpenFileOptions = {}): Promise<IpcResult<OpenFileResult>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const result = win
          ? await dialog.showOpenDialog(win, {
              title: options.title,
              filters: options.filters,
              properties: ['openFile']
            })
          : await dialog.showOpenDialog({
              title: options.title,
              filters: options.filters,
              properties: ['openFile']
            })
        if (result.canceled || result.filePaths.length === 0) {
          return { success: true, data: { filePath: null } }
        }
        return { success: true, data: { filePath: result.filePaths[0] } }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  ipcMain.handle(
    'dialog:saveFile',
    async (event, options: SaveFileOptions = {}): Promise<IpcResult<SaveFileResult>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const opts: Electron.SaveDialogOptions = {
          title: options.title,
          defaultPath: options.defaultPath,
          filters: options.filters
        }
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) {
          return { success: true, data: { filePath: null } }
        }
        return { success: true, data: { filePath: result.filePath } }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )
}
