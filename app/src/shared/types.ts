// 项目状态枚举
export type ProjectStage = 'recording' | 'editor' | 'canvas' | 'done'

// 项目基础信息
export interface Project {
  id: number
  name: string
  stage: ProjectStage // 上次停留的阶段
  createdAt: number // Unix timestamp
  updatedAt: number
}

// 项目内容（各阶段数据）
export interface ProjectContent {
  projectId: number
  rawTranscript: string | null // 原始转写文字
  script: string | null // 整理后演讲稿
  pagesJson: string | null // 分页结果 JSON 字符串
  excalidrawJson: string | null // Excalidraw 页面 JSON
}

// IPC 调用返回的通用结构
export interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** generateAllSlides 的返回数据：alreadyRunning=true 表示同一项目已有在跑的任务，本次被静默忽略 */
export interface GenerateAllSlidesResult {
  alreadyRunning?: boolean
}

// 应用设置
export interface Settings {
  llmApiBaseUrl: string
  llmApiKey: string
  llmModel: string
  whisperModelPath: string
  whisperCliPath: string
  language: 'auto' | 'zh' | 'en'
}

// 单页幻灯片大纲（LLM 分页产物，存入 ProjectContent.pagesJson 时 JSON.stringify）
export interface PageSlide {
  /** 幻灯片标题 */
  title: string
  /** 该页的核心要点（简洁短语） */
  points: string[]
  /** 这段演讲内容的简要概括（2-3句），供后续生成示意图时理解语义与逻辑关系 */
  summary: string
}

/**
 * 单页的 Excalidraw 渲染数据
 *
 * 存储到 project_contents.excalidrawJson 字段时的格式：
 *   JSON.stringify(ExcalidrawPage[])
 *
 * - 主进程只做 JSON 的读写与增量合并，不引入 @excalidraw/excalidraw 依赖
 * - renderer 侧消费时可将 elements 直接 cast 为 ExcalidrawElement[]
 */
export interface ExcalidrawPage {
  /** 0-based，对应 pagesJson[pageIndex] */
  pageIndex: number
  /** Excalidraw elements 数组，具体类型由 renderer 负责 */
  elements: unknown[]
  /** 可选：背景色等 appState 片段 */
  appState?: Record<string, unknown>
}
