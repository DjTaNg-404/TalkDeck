import db from './database'
import type { ProjectContent } from '../../shared/types'

/** 允许通过 upsertContent 写入的列白名单，防止 patch 携带任意 key 拼入 SQL */
const UPDATABLE_COLUMNS = ['rawTranscript', 'script', 'pagesJson', 'excalidrawJson'] as const
type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number]

export function getContent(projectId: number): ProjectContent | null {
  return (
    (db
      .prepare('SELECT * FROM project_contents WHERE projectId = ?')
      .get(projectId) as ProjectContent) ?? null
  )
}

export function upsertContent(
  projectId: number,
  patch: Partial<Omit<ProjectContent, 'projectId'>>
): void {
  // 仅保留白名单内的字段，丢弃任何未知 key
  const sanitized: Partial<Record<UpdatableColumn, unknown>> = {}
  for (const key of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sanitized[key] = (patch as Record<string, unknown>)[key]
    }
  }

  const existing = getContent(projectId)
  if (!existing) {
    db.prepare(
      `INSERT INTO project_contents (projectId, rawTranscript, script, pagesJson, excalidrawJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      projectId,
      (sanitized.rawTranscript as string | null | undefined) ?? null,
      (sanitized.script as string | null | undefined) ?? null,
      (sanitized.pagesJson as string | null | undefined) ?? null,
      (sanitized.excalidrawJson as string | null | undefined) ?? null
    )
  } else {
    const fields: string[] = []
    const values: unknown[] = []
    for (const key of UPDATABLE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
        fields.push(`${key} = ?`)
        values.push(sanitized[key])
      }
    }
    if (fields.length > 0) {
      values.push(projectId)
      db.prepare(`UPDATE project_contents SET ${fields.join(', ')} WHERE projectId = ?`).run(
        ...values
      )
    }
  }
}
