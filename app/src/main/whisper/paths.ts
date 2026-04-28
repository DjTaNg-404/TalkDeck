import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { configureAppIdentity } from '../appIdentity'

configureAppIdentity()

/**
 * 本地 Whisper 资源的统一路径约定。
 *
 *   <userData>/whisper/
 *     ├── bin/
 *     │   ├── whisper-cli         可执行文件（setup 脚本编译产物）
 *     │   └── ggml-metal.metal    Metal shader（Apple Silicon 可选）
 *     └── models/
 *         └── ggml-*.bin
 */

export function getWhisperDir(): string {
  return join(app.getPath('userData'), 'whisper')
}

export function getWhisperBinDir(): string {
  return join(getWhisperDir(), 'bin')
}

export function getWhisperBinPath(): string {
  return join(getWhisperBinDir(), 'whisper-cli')
}

export function getWhisperModelsDir(): string {
  return join(getWhisperDir(), 'models')
}

/**
 * 确保目录结构存在。首次运行时创建。
 */
export async function ensureWhisperDirs(): Promise<void> {
  await fs.mkdir(getWhisperBinDir(), { recursive: true })
  await fs.mkdir(getWhisperModelsDir(), { recursive: true })
}

/**
 * 扫描 models 目录，返回所有 .bin 模型文件的名称列表（不含路径）。
 */
export async function listInstalledModels(): Promise<string[]> {
  const dir = getWhisperModelsDir()
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((name) => name.endsWith('.bin')).sort()
  } catch {
    return []
  }
}
