import { ipcMain } from 'electron'
import { getAllProjects, createProject, deleteProject, updateProjectStage } from '../db/projects'
import { getContent, upsertContent } from '../db/contents'
import db from '../db/database'
import type { IpcResult, Settings, ProjectStage } from '../../shared/types'

// 默认设置
const defaultSettings: Settings = {
  llmApiBaseUrl: 'https://api.openai.com/v1',
  llmApiKey: '',
  llmModel: 'gpt-4o',
  whisperModelPath: '',
  whisperCliPath: '',
  language: 'auto'
}

function autoProjectName(): string {
  const now = new Date()
  const m = now.getMonth() + 1
  const d = now.getDate()
  return `未命名项目 · ${m}月${d}日`
}

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:getAll', (): IpcResult<ReturnType<typeof getAllProjects>> => {
    try {
      return { success: true, data: getAllProjects() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle(
    'projects:create',
    (_event, name?: string): IpcResult<ReturnType<typeof createProject>> => {
      try {
        const project = createProject(name || autoProjectName())
        return { success: true, data: project }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  ipcMain.handle('projects:delete', (_event, id: number): IpcResult<void> => {
    try {
      deleteProject(id)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle(
    'projects:updateStage',
    (_event, payload: { id: number; stage: ProjectStage }): IpcResult<void> => {
      try {
        updateProjectStage(payload.id, payload.stage)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  ipcMain.handle('projects:getContent', (_event, projectId: number) => {
    try {
      return { success: true, data: getContent(projectId) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle(
    'projects:upsertContent',
    (_event, payload: { projectId: number; patch: Record<string, unknown> }): IpcResult<void> => {
      try {
        upsertContent(payload.projectId, payload.patch)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', (): IpcResult<Settings> => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all() as {
        key: string
        value: string
      }[]
      const stored: Record<string, string> = {}
      for (const row of rows) {
        stored[row.key] = row.value
      }
      const settings: Settings = {
        llmApiBaseUrl: stored.llmApiBaseUrl ?? defaultSettings.llmApiBaseUrl,
        llmApiKey: stored.llmApiKey ?? defaultSettings.llmApiKey,
        llmModel: stored.llmModel ?? defaultSettings.llmModel,
        whisperModelPath: stored.whisperModelPath ?? defaultSettings.whisperModelPath,
        whisperCliPath: stored.whisperCliPath ?? defaultSettings.whisperCliPath,
        language: (stored.language as Settings['language']) ?? defaultSettings.language
      }
      return { success: true, data: settings }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>): IpcResult<void> => {
    try {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      const runMany = db.transaction((entries: [string, string][]) => {
        for (const [key, value] of entries) {
          upsert.run(key, value)
        }
      })
      const entries = Object.entries(patch).map(([k, v]) => [k, String(v)] as [string, string])
      runMany(entries)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}
