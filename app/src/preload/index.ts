import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  projects: {
    getAll: () => ipcRenderer.invoke('projects:getAll'),
    create: (name?: string) => ipcRenderer.invoke('projects:create', name),
    delete: (id: number) => ipcRenderer.invoke('projects:delete', id),
    updateStage: (id: number, stage: string) =>
      ipcRenderer.invoke('projects:updateStage', { id, stage }),
    getContent: (projectId: number) => ipcRenderer.invoke('projects:getContent', projectId),
    upsertContent: (projectId: number, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('projects:upsertContent', { projectId, patch })
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch)
  },
  audio: {
    saveBlob: (projectId: number, buffer: ArrayBuffer) =>
      ipcRenderer.invoke('audio:saveBlob', { projectId, buffer }),
    transcribe: (projectId: number, filePath: string, language: string) =>
      ipcRenderer.invoke('audio:transcribe', { projectId, filePath, language }),
    getWhisperStatus: () => ipcRenderer.invoke('audio:getWhisperStatus'),
    // Electron 32+ 移除了 File.path，需通过 webUtils 在 preload 里获取
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  dialog: {
    openFile: (options?: { title?: string; filters?: Electron.FileFilter[] }) =>
      ipcRenderer.invoke('dialog:openFile', options ?? {}),
    saveFile: (options?: {
      title?: string
      defaultPath?: string
      filters?: Electron.FileFilter[]
    }) => ipcRenderer.invoke('dialog:saveFile', options ?? {})
  },
  llm: {
    arrangeScript: (projectId: number) => ipcRenderer.invoke('llm:arrangeScript', { projectId }),
    streamArrangeScript: (projectId: number) =>
      ipcRenderer.invoke('llm:streamArrangeScript', { projectId }),
    generatePages: (projectId: number, hint?: string) =>
      ipcRenderer.invoke('llm:generatePages', { projectId, hint }),
    generateSlide: (projectId: number, pageIndex: number, hint?: string) =>
      ipcRenderer.invoke('llm:generateSlide', { projectId, pageIndex, hint }),
    generateAllSlides: (projectId: number, hint?: string) =>
      ipcRenderer.invoke('llm:generateAllSlides', { projectId, hint }),
    /** 订阅流式整理的增量事件，返回取消订阅函数 */
    onStreamChunk: (
      callback: (payload: { projectId: number; delta: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { projectId: number; delta: string }
      ): void => callback(payload)
      ipcRenderer.on('llm:chunk', listener)
      return () => ipcRenderer.removeListener('llm:chunk', listener)
    },
    /** 订阅单页生成完成事件，返回取消订阅函数 */
    onSlideReady: (
      callback: (payload: { projectId: number; pageIndex: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { projectId: number; pageIndex: number }
      ): void => callback(payload)
      ipcRenderer.on('llm:slideReady', listener)
      return () => ipcRenderer.removeListener('llm:slideReady', listener)
    },
    /** 订阅单页状态变化（queued / streaming / ready），返回取消订阅函数 */
    onSlideStatus: (
      callback: (payload: {
        projectId: number
        pageIndex: number
        status: 'queued' | 'streaming' | 'ready'
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          projectId: number
          pageIndex: number
          status: 'queued' | 'streaming' | 'ready'
        }
      ): void => callback(payload)
      ipcRenderer.on('llm:slideStatus', listener)
      return () => ipcRenderer.removeListener('llm:slideStatus', listener)
    }
  },
  export: {
    toPptx: (payload: {
      filePath: string
      title: string
      slides: { pngBuffer: number[]; title: string }[]
    }) => ipcRenderer.invoke('export:toPptx', payload),
    toExcalidraw: (payload: { filePath: string; projectId: number }) =>
      ipcRenderer.invoke('export:toExcalidraw', payload),
    toMarkdown: (payload: { filePath: string; projectId: number }) =>
      ipcRenderer.invoke('export:toMarkdown', payload)
  },
  dark: {
    /** 订阅系统深色模式变化，返回取消订阅函数 */
    onChange: (cb: (isDark: boolean) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, isDark: boolean): void => cb(isDark)
      ipcRenderer.on('dark:change', listener)
      return () => ipcRenderer.removeListener('dark:change', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
