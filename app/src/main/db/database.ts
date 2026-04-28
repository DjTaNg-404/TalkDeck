import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { configureAppIdentity, migrateLegacyUserData } from '../appIdentity'

configureAppIdentity()
migrateLegacyUserData()

const dbPath = join(app.getPath('userData'), 'talkdeck.db')
const db = new Database(dbPath)

// 开启 WAL 模式，提升并发读写性能
db.pragma('journal_mode = WAL')
// 启用外键约束，确保 project_contents 的 ON DELETE CASCADE 生效
db.pragma('foreign_keys = ON')

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    stage       TEXT    NOT NULL DEFAULT 'recording',
    createdAt   INTEGER NOT NULL,
    updatedAt   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_contents (
    projectId      INTEGER PRIMARY KEY,
    rawTranscript  TEXT,
    script         TEXT,
    pagesJson      TEXT,
    excalidrawJson TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

export default db
