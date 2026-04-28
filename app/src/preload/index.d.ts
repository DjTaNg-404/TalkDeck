import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Project,
  ProjectContent,
  ProjectStage,
  Settings,
  IpcResult,
  PageSlide,
  ExcalidrawPage,
  GenerateAllSlidesResult
} from '../shared/types'

interface ApiProjects {
  getAll(): Promise<IpcResult<Project[]>>
  create(name?: string): Promise<IpcResult<Project>>
  delete(id: number): Promise<IpcResult<void>>
  updateStage(id: number, stage: ProjectStage): Promise<IpcResult<void>>
  getContent(projectId: number): Promise<IpcResult<ProjectContent | null>>
  upsertContent(
    projectId: number,
    patch: Partial<Omit<ProjectContent, 'projectId'>>
  ): Promise<IpcResult<void>>
}

interface ApiSettings {
  get(): Promise<IpcResult<Settings>>
  set(patch: Partial<Settings>): Promise<IpcResult<void>>
}

interface ApiAudio {
  saveBlob(projectId: number, buffer: ArrayBuffer): Promise<IpcResult<{ filePath: string }>>
  transcribe(
    projectId: number,
    filePath: string,
    language: string
  ): Promise<IpcResult<{ transcript: string }>>
  getWhisperStatus(): Promise<IpcResult<{ ready: boolean; message: string }>>
  getPathForFile(file: File): string
}

interface ApiDialog {
  openFile(options?: {
    title?: string
    filters?: Electron.FileFilter[]
  }): Promise<IpcResult<{ filePath: string | null }>>
  saveFile(options?: {
    title?: string
    defaultPath?: string
    filters?: Electron.FileFilter[]
  }): Promise<IpcResult<{ filePath: string | null }>>
}

interface ApiLLM {
  arrangeScript(projectId: number): Promise<IpcResult<string>>
  streamArrangeScript(projectId: number): Promise<IpcResult<string>>
  generatePages(projectId: number, hint?: string): Promise<IpcResult<PageSlide[]>>
  generateSlide(
    projectId: number,
    pageIndex: number,
    hint?: string
  ): Promise<IpcResult<ExcalidrawPage>>
  generateAllSlides(projectId: number, hint?: string): Promise<IpcResult<GenerateAllSlidesResult>>
  onStreamChunk(callback: (payload: { projectId: number; delta: string }) => void): () => void
  onSlideReady(callback: (payload: { projectId: number; pageIndex: number }) => void): () => void
  onSlideStatus(
    callback: (payload: {
      projectId: number
      pageIndex: number
      status: 'queued' | 'streaming' | 'ready'
    }) => void
  ): () => void
}

interface ApiExport {
  toPptx(payload: {
    filePath: string
    title: string
    slides: { pngBuffer: number[]; title: string }[]
  }): Promise<IpcResult<{ filePath: string }>>
  toExcalidraw(payload: {
    filePath: string
    projectId: number
  }): Promise<IpcResult<{ filePath: string }>>
  toMarkdown(payload: {
    filePath: string
    projectId: number
  }): Promise<IpcResult<{ filePath: string }>>
}

interface ApiDark {
  onChange(cb: (isDark: boolean) => void): () => void
}

interface Api {
  projects: ApiProjects
  settings: ApiSettings
  audio: ApiAudio
  dialog: ApiDialog
  llm: ApiLLM
  export: ApiExport
  dark: ApiDark
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
