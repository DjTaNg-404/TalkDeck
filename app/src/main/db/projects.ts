import db from './database'
import type { Project, ProjectStage } from '../../shared/types'

export function getAllProjects(): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC').all() as Project[]
}

export function createProject(name: string): Project {
  const now = Date.now()
  const result = db
    .prepare('INSERT INTO projects (name, stage, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run(name, 'recording', now, now)
  return {
    id: result.lastInsertRowid as number,
    name,
    stage: 'recording',
    createdAt: now,
    updatedAt: now
  }
}

export function getProjectById(id: number): Project | null {
  return (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project) ?? null
}

export function updateProjectStage(id: number, stage: ProjectStage): void {
  db.prepare('UPDATE projects SET stage = ?, updatedAt = ? WHERE id = ?').run(stage, Date.now(), id)
}

export function deleteProject(id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}
