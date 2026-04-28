/**
 * LLM 客户端：OpenAI 兼容接口封装
 *
 * 使用 Node.js 原生 fetch（Electron 主进程支持），不引入额外 SDK。
 */

export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface LLMCallOptions {
  /** 系统提示词（可选） */
  system?: string
  /** 采样温度，默认 0.7 */
  temperature?: number
  /** 超时毫秒，默认 60000 */
  timeoutMs?: number
  /** AbortSignal，外部可主动取消 */
  signal?: AbortSignal
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function buildMessages(prompt: string, system?: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (system && system.trim()) {
    messages.push({ role: 'system', content: system })
  }
  messages.push({ role: 'user', content: prompt })
  return messages
}

function assertConfig(config: LLMConfig): void {
  if (!config.baseUrl || !config.baseUrl.trim()) {
    throw new Error('LLM baseUrl 未配置，请到设置页填写 LLM API Base URL')
  }
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error('LLM apiKey 未配置，请到设置页填写 LLM API Key')
  }
  if (!config.model || !config.model.trim()) {
    throw new Error('LLM model 未配置，请到设置页填写模型名称')
  }
}

function buildEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return `${trimmed}/chat/completions`
}

/**
 * 普通（非流式）调用。返回完整文本。
 */
export async function callLLM(
  prompt: string,
  config: LLMConfig,
  options: LLMCallOptions = {}
): Promise<string> {
  assertConfig(config)

  const { system, temperature = 0.7, timeoutMs = 300000, signal } = options

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const resp = await fetch(buildEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(prompt, system),
        temperature,
        stream: false
      }),
      signal: controller.signal
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 300)}`)
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('LLM 响应缺少 choices[0].message.content')
    }
    return content
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`LLM 调用超时（${timeoutMs}ms）或被取消`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式调用。每收到一个增量 token，触发 onChunk(delta)。
 * Promise 在流结束时 resolve 为完整文本。
 */
export async function streamLLM(
  prompt: string,
  config: LLMConfig,
  onChunk: (delta: string) => void,
  options: LLMCallOptions = {}
): Promise<string> {
  assertConfig(config)

  const { system, temperature = 0.7, timeoutMs = 300000, signal } = options

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const resp = await fetch(buildEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(prompt, system),
        temperature,
        stream: true
      }),
      signal: controller.signal
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 300)}`)
    }
    if (!resp.body) {
      throw new Error('LLM 响应缺少 body，无法流式读取')
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let full = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按行切分，保留最后一段未完整的
      let nlIdx: number
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, nlIdx).replace(/\r$/, '')
        buffer = buffer.slice(nlIdx + 1)
        if (!rawLine) continue // 空行分隔事件
        if (!rawLine.startsWith('data:')) continue

        const data = rawLine.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            full += delta
            onChunk(delta)
          }
        } catch {
          // 忽略无法解析的片段（例如心跳或注释行）
        }
      }
    }

    return full
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`LLM 流式调用超时（${timeoutMs}ms）或被取消`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
