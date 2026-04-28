import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import db from '../db/database'
import { upsertContent } from '../db/contents'
import { updateProjectStage } from '../db/projects'
import {
  ensureWhisperDirs,
  getWhisperBinPath,
  getWhisperModelsDir,
  listInstalledModels
} from '../whisper/paths'
import type { IpcResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

// whisper/ffmpeg 子进程 stdout 可能很大（长音频），放宽 maxBuffer 到 64MB
const EXEC_MAX_BUFFER = 64 * 1024 * 1024

// ---- Payload & Result Types ----

interface SaveBlobPayload {
  projectId: number
  buffer: ArrayBuffer
}

interface SaveBlobResult {
  filePath: string
}

interface TranscribePayload {
  projectId: number
  filePath: string
  language: string
}

interface TranscribeResult {
  transcript: string
}

interface WhisperStatusResult {
  ready: boolean
  message: string
}

// ---- Settings helpers ----

/**
 * 从 settings 表读取单个 key。不依赖 Settings 类型，便于 Step 8 之前使用尚未
 * 正式挂到 Settings 接口上的 `whisperCliPath` / `ffmpegPath` 等扩展字段。
 */
function getSettingValue(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const value = row?.value?.trim()
  return value && value.length > 0 ? value : null
}

/**
 * ffmpeg 路径解析（优先级从高到低）：
 *   1. settings.ffmpegPath（用户自定义覆盖）
 *   2. ffmpeg-static 预编译二进制（随 npm 安装）
 *   3. PATH 中的 `ffmpeg`
 */
function resolveFfmpegPath(): string {
  return getSettingValue('ffmpegPath') ?? ffmpegStatic ?? 'ffmpeg'
}

/**
 * whisper-cli 路径解析（优先级从高到低）：
 *   1. settings.whisperCliPath（用户自定义覆盖）
 *   2. <userData>/whisper/bin/whisper-cli（setup 脚本产物）
 *   3. 模型文件同级目录的 whisper-cli
 *   4. PATH 中的 `whisper-cli`
 */
function resolveWhisperCliPath(modelPath: string | null): string {
  const configured = getSettingValue('whisperCliPath')
  if (configured) return configured
  return (
    getWhisperBinPath() || // 始终返回标准路径；存在性检查放在 getWhisperStatus
    (modelPath ? join(modelPath, '..', 'whisper-cli') : 'whisper-cli')
  )
}

/**
 * 模型路径解析（优先级从高到低）：
 *   1. settings.whisperModelPath（用户选择的"当前模型"绝对路径）
 *   2. <userData>/whisper/models/ 下第一个 .bin
 */
async function resolveModelPath(): Promise<string | null> {
  const configured = getSettingValue('whisperModelPath')
  if (configured) return configured
  const installed = await listInstalledModels()
  if (installed.length === 0) return null
  return join(getWhisperModelsDir(), installed[0])
}

// ---- Core flow ----

async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  const ffmpeg = resolveFfmpegPath()
  await execFileAsync(
    ffmpeg,
    [
      '-i',
      inputPath,
      '-ar',
      '16000', // 16kHz 采样率
      '-ac',
      '1', // mono 单声道
      '-c:a',
      'pcm_s16le',
      '-y',
      outputPath
    ],
    { maxBuffer: EXEC_MAX_BUFFER }
  )
}

async function runWhisper(wavPath: string, modelPath: string, language: string): Promise<string> {
  const cli = resolveWhisperCliPath(modelPath)
  const langArgs = language === 'auto' ? [] : ['-l', language]
  const { stdout } = await execFileAsync(
    cli,
    [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '--no-timestamps',
      '--no-prints', // 抑制 whisper 的 banner/进度打印到 stdout
      ...langArgs
    ],
    { maxBuffer: EXEC_MAX_BUFFER }
  )
  return stdout.trim()
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch {
    // ignore
  }
}

// ---- Handlers ----

export function registerAudioHandlers(): void {
  // 启动时确保 Whisper 目录结构存在
  ensureWhisperDirs().catch((e) => console.error('ensureWhisperDirs failed:', e))

  /**
   * 将 Renderer 传来的录音 ArrayBuffer 写入临时文件。
   */
  ipcMain.handle(
    'audio:saveBlob',
    async (_event, payload: SaveBlobPayload): Promise<IpcResult<SaveBlobResult>> => {
      try {
        const { projectId, buffer } = payload
        // 上限 500MB：单条录音再长也远低于此，超过即视为非法输入，避免 OOM
        const MAX_BLOB_BYTES = 500 * 1024 * 1024
        if (!buffer || typeof buffer.byteLength !== 'number' || buffer.byteLength === 0) {
          return { success: false, error: '录音数据为空' }
        }
        if (buffer.byteLength > MAX_BLOB_BYTES) {
          return {
            success: false,
            error: `录音数据过大（${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB），上限 500MB`
          }
        }
        const tempDir = app.getPath('temp')
        const fileName = `talkdeck-${projectId}-${Date.now()}.webm`
        const filePath = join(tempDir, fileName)
        await fs.writeFile(filePath, Buffer.from(buffer))
        return { success: true, data: { filePath } }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  /**
   * 对指定音频文件执行转写：ffmpeg 转 16kHz mono WAV → whisper-cli → 写入 DB。
   */
  ipcMain.handle(
    'audio:transcribe',
    async (_event, payload: TranscribePayload): Promise<IpcResult<TranscribeResult>> => {
      const { projectId, filePath, language } = payload
      const modelPath = await resolveModelPath()
      if (!modelPath) {
        return {
          success: false,
          error: '未找到 Whisper 模型，请到设置中下载或指定模型文件'
        }
      }

      const wavPath = join(app.getPath('temp'), `talkdeck-${projectId}-${Date.now()}.wav`)

      try {
        // 1. 转码为 whisper 所需的 16kHz mono WAV
        await convertToWav(filePath, wavPath)

        // 2. 调用 whisper-cli 转写
        const transcript = await runWhisper(wavPath, modelPath, language)

        if (!transcript) {
          return { success: false, error: 'Whisper 转写结果为空' }
        }

        // 3. 写入数据库并推进项目阶段
        upsertContent(projectId, { rawTranscript: transcript })
        updateProjectStage(projectId, 'editor')

        return { success: true, data: { transcript } }
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string }
        const detail = err.stderr || err.message || String(e)
        return { success: false, error: `转写失败：${detail}` }
      } finally {
        // 4. 清理临时 WAV
        await safeUnlink(wavPath)
        // 只清理应用自己产生的源文件（talkdeck-* 前缀），避免误删用户上传的原始音频
        if (basename(filePath).startsWith('talkdeck-')) {
          await safeUnlink(filePath)
        }
      }
    }
  )

  /**
   * 检查 whisper 模型与可执行文件是否就绪。
   */
  ipcMain.handle('audio:getWhisperStatus', async (): Promise<IpcResult<WhisperStatusResult>> => {
    try {
      // 模型检查
      const modelPath = await resolveModelPath()
      if (!modelPath) {
        return {
          success: true,
          data: { ready: false, message: '未安装 Whisper 模型，请到设置中下载' }
        }
      }
      try {
        await fs.access(modelPath)
      } catch {
        return {
          success: true,
          data: { ready: false, message: `Whisper 模型文件不存在：${modelPath}` }
        }
      }

      // CLI 检查
      const cli = resolveWhisperCliPath(modelPath)
      if (cli.includes('/') || cli.includes('\\')) {
        try {
          await fs.access(cli)
        } catch {
          return {
            success: true,
            data: {
              ready: false,
              message: `Whisper 可执行文件不存在：${cli}\n请运行 bash scripts/setup-whisper.sh 完成编译`
            }
          }
        }
      } else {
        try {
          await execFileAsync(cli, ['--help'], { maxBuffer: 1024 * 1024 })
        } catch {
          return {
            success: true,
            data: {
              ready: false,
              message: `未找到 whisper-cli，请运行 bash scripts/setup-whisper.sh`
            }
          }
        }
      }

      return { success: true, data: { ready: true, message: 'Whisper 已就绪' } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}
