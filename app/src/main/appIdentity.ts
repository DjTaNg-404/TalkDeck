import { app } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const APP_NAME = 'TalkDeck'
const LEGACY_APP_NAMES = ['app', 'talkdeck']

export function configureAppIdentity(): void {
  app.setName(APP_NAME)
}

function copyIfMissing(from: string, to: string): void {
  if (!existsSync(from) || existsSync(to)) return
  mkdirSync(join(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
}

export function migrateLegacyUserData(): void {
  const currentDir = app.getPath('userData')
  const appDataDir = app.getPath('appData')

  for (const legacyName of LEGACY_APP_NAMES) {
    const legacyDir = join(appDataDir, legacyName)
    if (legacyDir === currentDir || !existsSync(legacyDir)) continue

    copyIfMissing(join(legacyDir, 'talkdeck.db'), join(currentDir, 'talkdeck.db'))
    copyIfMissing(join(legacyDir, 'talkdeck.db-wal'), join(currentDir, 'talkdeck.db-wal'))
    copyIfMissing(join(legacyDir, 'talkdeck.db-shm'), join(currentDir, 'talkdeck.db-shm'))
    copyIfMissing(join(legacyDir, 'whisper'), join(currentDir, 'whisper'))
  }
}

configureAppIdentity()
