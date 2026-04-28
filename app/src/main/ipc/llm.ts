import { ipcMain, BrowserWindow } from 'electron'
import { getContent, upsertContent } from '../db/contents'
import db from '../db/database'
import { callLLM, streamLLM, type LLMConfig } from '../llm/client'
import type {
  IpcResult,
  PageSlide,
  ExcalidrawPage,
  GenerateAllSlidesResult
} from '../../shared/types'

// ---- Prompt 模板 ----

const ARRANGE_SCRIPT_PROMPT = `你是一位演讲稿润色助手。请将以下语音转写文本整理为流畅的中文演讲稿：
- 去除口头禅、重复词、语气词（嗯、啊、那个等）
- 保留说话人的语气和个人风格
- 补充必要的过渡语，使段落衔接自然
- 不要添加原文没有的内容，不要改变核心观点
- 直接输出演讲稿正文，不要加任何说明

原始转写：
{rawTranscript}`

const GENERATE_PAGES_PROMPT = `请将以下演讲稿拆分为幻灯片页面大纲，输出严格的 JSON 数组，不要有任何其他文字：
[
  {
    "title": "页面标题（不超过15字）",
    "points": ["核心要点1（不超过15字）", "核心要点2", "核心要点3"，……（要点数根据演讲内容自然划分）],
    "summary": "5-6句话概括这一段演讲的主要内容、语气和逻辑关系（例如：演讲者在这里通过对比说明……）"
  }
]

要求：
- 每条要点不超过15字
- 页数与要点数量根据演讲内容自然划分，不要强行合并或拆分
- summary 要体现这段演讲的实质内容和逻辑，不要只重复 points
- 所有文字均为中文
- 只输出 JSON 数组，不要 markdown 代码块，不要任何说明
{userHint}
演讲稿：
{script}`

const GENERATE_SLIDE_PROMPT = `你是一位顶尖的演示文稿视觉设计师，正在为一位讲述者生成一页 Excalidraw 风格幻灯片。
你的目标不是装饰页面，而是把这一页的讲述逻辑变成清晰、可讲、可展示的视觉结构。

幻灯片标题：{title}
核心要点：
{points}
演讲内容概要：{summary}
{globalOutline}

---

【生成前的内部设计判断（只在脑中完成，不要输出这部分）】

1. 判断当前页在整套演示中的页面角色：
   - opening：开场/提出主题
   - concept：解释一个概念
   - process：讲清流程或步骤
   - comparison：做对比或取舍
   - timeline：描述时间线或演进
   - matrix：呈现分类、象限或多维关系
   - case：拆解案例或例子
   - data：突出数据、指标或趋势
   - transition：承上启下
   - conclusion：总结、结论或行动号召

2. 选择最适合本页内容的 layoutType：
   - title_statement：一句核心判断 + 少量支撑
   - process_flow：流程图 / 路径 / 步骤推进
   - comparison：左右对比 / 前后对比 / 优劣取舍
   - timeline：时间线 / 阶段演进
   - matrix：二维矩阵 / 分类表 / 象限
   - concept_map：中心概念向外发散
   - before_after：变化前后 / 改造前后
   - problem_solution：问题到方案
   - case_breakdown：案例结构拆解
   - summary_takeaway：总结页 / 关键收获

3. 决定这一页的视觉隐喻：
   可以是路径、桥梁、地图、分层、放大镜、舞台、齿轮、仪表盘、拼图、阶梯等。
   视觉隐喻必须服务内容，不要为了装饰而使用。

4. 决定页面视觉重心：
   标题区、主视觉区、解释区、辅助标注区分别放在哪里。

5. 明确拒绝默认惰性布局：
   不要默认生成「标题 + 三张卡片」。只有当内容真的适合卡片并列时才使用卡片。

---

【设计护栏】

这些不是固定模板，而是为了避免低质量输出的设计边界。
请优先根据当前页内容选择最合适的视觉表达，不要机械套用任何一种版式。

**① 结构优先**
- 先选择适合内容的 layoutType，再决定具体画面。
- 不要默认使用「标题 + 三张卡片」。
- 只有当内容天然适合并列分组时，才使用卡片。
- 流程、对比、时间线、矩阵、概念图、问题-解决等内容，应优先使用对应的结构化版式。

**② 颜色有语义**
- 颜色要帮助理解内容，而不是随机装饰。
- 同一概念在同一套演示中保持相同颜色。
- 可以参考以下语义色，但不必每页全部使用：
  - 蓝色（fill #a5d8ff / stroke #1971c2）：流程、步骤、核心路径
  - 绿色（fill #b2f2bb / stroke #2f9e44）：结果、完成、收益
  - 橙色（fill #ffd8a8 / stroke #e8590c）：行动、重点、转折
  - 紫色（fill #d0bfff / stroke #7048e8）：洞察、亮点、抽象概念
  - 青色（fill #99e9f2 / stroke #0c8599）：补充信息、辅助关系
  - 红色（fill #ffc9c9 / stroke #e03131）：风险、问题、冲突
  - 灰色（fill #dee2e6 / stroke #495057）：背景、容器、连接线、弱信息

**③ 层级清楚**
- 页面必须有明显的信息层级。
- 标题、区块标签、正文说明、辅助注释要有可见差异。
- 字号可以根据页面气质自由调整，不强制固定数值。
- 文字要短，优先使用标签、编号、箭头和空间关系表达。

**④ 保留手绘感**
- 形状、线条、箭头可以保留 Excalidraw 的手绘质感。
- 文字必须清晰可读，不要为了手绘感牺牲可读性。
- 页面可以有装饰，但装饰必须服务理解。
- 建议形状 roughness=1，文字 roughness=0。

**⑤ 卡片使用限制**
- 如果使用卡片，禁止在彩色卡片内部再叠白色或浅色文字底板。
- 卡片文字应直接放在色块上，并保证对比度足够。
- 不要把每一页都做成卡片列表。

**⑥ 留白与节奏**
- 不要把元素平均铺满整个画布。
- 页面应该一眼看出主信息在哪里。
- 主要元素之间要有足够间距。
- 元素数量由内容决定，不要为了显得丰富而堆无意义图形。

**⑦ 整套一致**
- 延续上一页的色彩倾向、线条粗细、字号层级和装饰母题。
- 允许每页布局不同，但不要像来自不同模板。

---

【技术约束（必须严格遵守）】
- 画布 1280×720，每个元素的四条边必须全部在画布内：x ≥ 0、y ≥ 0、x + width ≤ 1280、y + height ≤ 720。绝对不允许任何元素溢出画布。
- Excalidraw text 元素**不自动换行**，长文必须用 '\\n' 手动换行；单个 text 的 width 要足以容纳最长一行。
- 只输出合法 Excalidraw JSON **数组**，不要任何解释、不要 markdown 代码块、不要外层对象包裹。
- 合法 type 仅：text / rectangle / ellipse / arrow / line / diamond。
- 每个元素必须包含：id（随机字符串）、type、x、y、width、height、angle（0）、strokeColor、backgroundColor、fillStyle、strokeWidth、strokeStyle（"solid"）、roughness、opacity（100）、groupIds（[]）、frameId（null）、roundness（矩形圆角用 {"type":3}，其他 null）、seed（随机整数）、version（1）、versionNonce（随机整数）、isDeleted（false）、boundElements（null）、updated（1）、link（null）、locked（false）。
- text 元素额外：text、fontSize（数字）、fontFamily（1=Virgil手绘 / 2=Helvetica）、textAlign、verticalAlign、baseline（≈ fontSize × 0.8）、containerId（null）、originalText（= text，保留 \\n）、lineHeight（1.25）。
- arrow 元素额外：points（相对坐标数组，如 [[0,0],[200,0]]）、startBinding（null）、endBinding（null）、startArrowhead（null）、endArrowhead（"arrow"）。
{userHint}

---

【生成前自检清单】
在输出 JSON 前，默默在脑中过一遍：
- [ ] 是否判断了页面角色？
- [ ] 是否选择了合适的 layoutType？
- [ ] 是否避免了默认「标题 + 三张卡片」？
- [ ] 是否有至少 3 个字号层级？
- [ ] 颜色是否按语义分配而非随机？
- [ ] 卡片是否是彩色背景 + 文字直接放在色块上（无白色内框）？
- [ ] 形状 roughness=1，文字 roughness=0？
- [ ] 元素数量是否与 layoutType 匹配，而不是硬凑？
- [ ] 页面是否一眼能看出主信息？
- [ ] 所有元素是否完全在 1280×720 画布内？

现在开始生成：`

/**
 * 构造单页生成的 Prompt。
 * - allPages：整份演示所有页的大纲，让 LLM 理解宏观叙事结构与当前页所在位置。
 * - currentIndex：当前页在 allPages 中的索引（0-based）。
 * - prevElements：上一页已生成的 Excalidraw elements，用于风格参考（可为 null）。
 * - hint：用户对本页重新生成的调整意见（可为空）。
 */
function buildSlidePrompt(
  page: PageSlide,
  allPages: PageSlide[],
  currentIndex: number,
  prevElements: unknown[] | null,
  hint?: string
): string {
  // ---- 全局大纲段 ----
  const outlineLines: string[] = []
  outlineLines.push(`\n【演示全局结构（共 ${allPages.length} 页，当前第 ${currentIndex + 1} 页）】`)
  outlineLines.push('——帮助你理解整份演示的叙事脉络，当前页设计请紧扣本页内容，勿重复其他页：')
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i]
    const marker = i === currentIndex ? '→ ' : '  '
    const pointsStr = p.points.slice(0, 3).join(' / ')
    outlineLines.push(`${marker}${i + 1}. ${p.title}：${pointsStr}`)
  }
  const globalOutline = outlineLines.join('\n')

  // ---- 用户调整意见段（可选） ----
  const trimmedHint = hint?.trim() || ''
  const userHint = trimmedHint ? `\n【用户对本页的调整意见（请优先参考）】\n${trimmedHint}\n` : ''

  const base = GENERATE_SLIDE_PROMPT.replace('{title}', page.title)
    .replace('{points}', page.points.map((p) => `- ${p}`).join('\n'))
    .replace('{summary}', page.summary || '')
    .replace('{globalOutline}', globalOutline)
    .replace('{userHint}', userHint)

  if (!prevElements || prevElements.length === 0) return base

  // 风格参考：保留完整 JSON 让模型看到上一页的用色/字体/布局节奏
  const refJson = JSON.stringify(prevElements)
  return (
    base +
    `\n\n【风格参考 — 同一份演示的上一页】\n` +
    `为了让整份演示视觉连贯，请延续以下这一页的色彩体系、字号层级、版式节奏；` +
    `但本页内容、布局、焦点要重新设计，不要照抄结构：\n` +
    '```json\n' +
    refJson +
    '\n```'
  )
}

// ---- 工具 ----

/** 从 DB 读取 LLM 所需三项配置 */
function readLLMConfig(): LLMConfig {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    baseUrl: map.llmApiBaseUrl || 'https://api.openai.com/v1',
    apiKey: map.llmApiKey || '',
    model: map.llmModel || 'gpt-4o'
  }
}

/** 从可能含 markdown 代码块的字符串中抽出 JSON 数组文本 */
function extractJsonArray(raw: string): string {
  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : raw
  // 截取从第一个 [ 到最后一个 ] 之间
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    return body.trim()
  }
  return body.slice(start, end + 1)
}

function parsePages(raw: string): PageSlide[] {
  const jsonText = extractJsonArray(raw)
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) {
    throw new Error('LLM 返回不是数组')
  }
  const pages: PageSlide[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const points = Array.isArray(item.points)
      ? item.points.filter(
          (p: unknown): p is string => typeof p === 'string' && p.trim().length > 0
        )
      : []
    const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
    if (title && points.length > 0) {
      pages.push({ title, points, summary })
    }
  }
  if (pages.length === 0) {
    throw new Error('LLM 返回的页面数组为空或格式不正确')
  }
  return pages
}

// ---- Excalidraw 相关工具 ----

/** 生成 32 位随机字符串 id */
function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

/** 生成一个 31-bit 随机整数，作为 seed / versionNonce */
function randomNonce(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/**
 * 为 LLM 返回的 element 补全必要字段，防止 Excalidraw 渲染报错
 */
function normalizeElement(el: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: randomId(),
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomNonce(),
    version: 1,
    versionNonce: randomNonce(),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...el
  }
  if (base.type === 'text') {
    const text = typeof base.text === 'string' ? base.text : ''
    const fontSize = typeof base.fontSize === 'number' ? base.fontSize : 24
    return {
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'top',
      baseline: Math.round(fontSize * 0.8),
      containerId: null,
      originalText: text,
      lineHeight: 1.25,
      ...base,
      text,
      fontSize
    }
  }
  return base
}

/**
 * 将溢出 1280×720 画布的元素 clamp 回画布内。
 * 确保无论 LLM 生成什么，导出时不会裁切。
 */
function clampToCanvas(el: Record<string, unknown>): Record<string, unknown> {
  const CANVAS_W = 1280
  const CANVAS_H = 720
  const MARGIN = 0 // 允许贴边但不溢出
  let x = typeof el.x === 'number' ? el.x : 0
  let y = typeof el.y === 'number' ? el.y : 0
  let w = typeof el.width === 'number' ? el.width : 0
  let h = typeof el.height === 'number' ? el.height : 0

  // 如果元素本身比画布还大，等比缩小
  if (w > CANVAS_W - MARGIN * 2) w = CANVAS_W - MARGIN * 2
  if (h > CANVAS_H - MARGIN * 2) h = CANVAS_H - MARGIN * 2

  // 先保证右/下边不溢出，再保证左/上边不溢出
  x = Math.min(x, CANVAS_W - MARGIN - w)
  y = Math.min(y, CANVAS_H - MARGIN - h)
  x = Math.max(x, MARGIN)
  y = Math.max(y, MARGIN)

  return { ...el, x, y, width: w, height: h }
}

/**
 * 从 LLM 返回文本中解析出规范化后的 element 数组
 */
function parseSlideElements(raw: string): unknown[] {
  const jsonText = extractJsonArray(raw)
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) throw new Error('Excalidraw elements 不是数组')
  const elements: unknown[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.type !== 'string') continue
    elements.push(clampToCanvas(normalizeElement(obj)))
  }
  if (elements.length === 0) throw new Error('Excalidraw elements 数组为空')
  return elements
}

/**
 * LLM 失败时的降级页面：标题 + 要点的纯文字布局
 */
function fallbackSlideElements(page: PageSlide): unknown[] {
  const elements: unknown[] = []
  elements.push(
    normalizeElement({
      type: 'text',
      x: 120,
      y: 80,
      width: 1040,
      height: 60,
      text: page.title,
      fontSize: 40
    })
  )
  page.points.forEach((p, i) => {
    elements.push(
      normalizeElement({
        type: 'text',
        x: 160,
        y: 200 + i * 80,
        width: 960,
        height: 40,
        text: `• ${p}`,
        fontSize: 24
      })
    )
  })
  return elements
}

/** 读取现有 excalidrawJson 数组 */
function readExcalidrawPages(projectId: number): ExcalidrawPage[] {
  const raw = getContent(projectId)?.excalidrawJson
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ExcalidrawPage[]) : []
  } catch {
    return []
  }
}

/** 按 pageIndex 增量写入一页（per-project 串行，避免不同 pageIndex 并发的 read-modify-write 丢写） */
const slideWriteQueues = new Map<number, Promise<void>>()
function upsertSlidePage(projectId: number, page: ExcalidrawPage): Promise<void> {
  const prev = slideWriteQueues.get(projectId) ?? Promise.resolve()
  const next = prev
    .catch(() => {
      /* 上一次的错误不影响后续写入 */
    })
    .then(() => {
      const existing = readExcalidrawPages(projectId)
      const idx = existing.findIndex((p) => p.pageIndex === page.pageIndex)
      if (idx >= 0) existing[idx] = page
      else existing.push(page)
      existing.sort((a, b) => a.pageIndex - b.pageIndex)
      upsertContent(projectId, { excalidrawJson: JSON.stringify(existing) })
    })
  // 队尾追完后从 map 里清掉自身，避免 map 无限增长
  const cleaned = next.finally(() => {
    if (slideWriteQueues.get(projectId) === cleaned) {
      slideWriteQueues.delete(projectId)
    }
  })
  slideWriteQueues.set(projectId, cleaned)
  return cleaned
}

// ---- IPC 注册 ----

/** 正在执行 generateAllSlides 的项目 ID 集合，防止重复提交 */
const generatingProjects = new Set<number>()

/** 正在执行单页 generateSlide 的 (projectId, pageIndex) 集合，避免同一页并发写 */
const generatingSlides = new Set<string>()
const slideKey = (projectId: number, pageIndex: number): string => `${projectId}:${pageIndex}`

export function registerLLMHandlers(): void {
  /**
   * 非流式整理演讲稿：读取 rawTranscript → LLM → 写回 script → 返回整理后文本
   */
  ipcMain.handle(
    'llm:arrangeScript',
    async (_event, payload: { projectId: number }): Promise<IpcResult<string>> => {
      try {
        const content = getContent(payload.projectId)
        const rawTranscript = content?.rawTranscript?.trim()
        if (!rawTranscript) {
          return { success: false, error: '该项目还没有转写文本，无法整理演讲稿' }
        }

        const config = readLLMConfig()
        const prompt = ARRANGE_SCRIPT_PROMPT.replace('{rawTranscript}', rawTranscript)
        const script = (await callLLM(prompt, config, { temperature: 0.5 })).trim()
        if (!script) {
          return { success: false, error: 'LLM 返回内容为空' }
        }

        upsertContent(payload.projectId, { script })
        return { success: true, data: script }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )

  /**
   * 流式整理演讲稿。每个增量通过 'llm:chunk' 事件推送到对应窗口。
   * 结束后自动写入 DB，并在返回值中给出完整 script。
   */
  ipcMain.handle(
    'llm:streamArrangeScript',
    async (event, payload: { projectId: number }): Promise<IpcResult<string>> => {
      try {
        const content = getContent(payload.projectId)
        const rawTranscript = content?.rawTranscript?.trim()
        if (!rawTranscript) {
          return { success: false, error: '该项目还没有转写文本，无法整理演讲稿' }
        }

        const config = readLLMConfig()
        const prompt = ARRANGE_SCRIPT_PROMPT.replace('{rawTranscript}', rawTranscript)

        const win = BrowserWindow.fromWebContents(event.sender)
        const sendChunk = (delta: string): void => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('llm:chunk', { projectId: payload.projectId, delta })
          }
        }

        const script = (await streamLLM(prompt, config, sendChunk, { temperature: 0.5 })).trim()
        if (!script) {
          return { success: false, error: 'LLM 返回内容为空' }
        }

        upsertContent(payload.projectId, { script })
        return { success: true, data: script }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )

  /**
   * 根据 script 生成页面大纲，写入 pagesJson 并返回 PageSlide[]。
   */
  ipcMain.handle(
    'llm:generatePages',
    async (
      _event,
      payload: { projectId: number; hint?: string }
    ): Promise<IpcResult<PageSlide[]>> => {
      try {
        // 与批量生成幻灯片互斥：避免重新分页清空 excalidrawJson 时，正在跑的批量任务把陈旧
        // pageIndex 的内容又写回去，造成新旧分页错位
        if (generatingProjects.has(payload.projectId)) {
          return {
            success: false,
            error: '正在批量生成幻灯片，请等待当前任务完成后再重新分页'
          }
        }
        const content = getContent(payload.projectId)
        const script = content?.script?.trim()
        if (!script) {
          return { success: false, error: '该项目还没有演讲稿，无法生成分页' }
        }

        const config = readLLMConfig()
        const trimmedHint = payload.hint?.trim() || ''
        const userHint = trimmedHint
          ? `\n【用户对分页的调整意见（请优先参考）】\n${trimmedHint}\n`
          : ''
        const prompt = GENERATE_PAGES_PROMPT.replace('{script}', script).replace(
          '{userHint}',
          userHint
        )
        const raw = await callLLM(prompt, config, { temperature: 0.3 })

        let pages: PageSlide[]
        try {
          pages = parsePages(raw)
        } catch (parseErr) {
          return {
            success: false,
            error: `分页 JSON 解析失败：${(parseErr as Error).message}`
          }
        }

        upsertContent(payload.projectId, {
          pagesJson: JSON.stringify(pages),
          // 重新分页后旧的 excalidrawJson 已与新的 pageIndex/标题对不上，清空避免错位显示
          excalidrawJson: null
        })
        return { success: true, data: pages }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      }
    }
  )

  /**
   * 为单页生成 Excalidraw JSON，增量写回 excalidrawJson，返回该页的 ExcalidrawPage。
   */
  ipcMain.handle(
    'llm:generateSlide',
    async (
      event,
      payload: { projectId: number; pageIndex: number; hint?: string }
    ): Promise<IpcResult<ExcalidrawPage>> => {
      // 与批量生成互斥，避免对同一项目的 excalidrawJson 产生 read-modify-write 竞态
      if (generatingProjects.has(payload.projectId)) {
        return {
          success: false,
          error: '正在批量生成幻灯片，请等待当前任务完成后再单页重生成'
        }
      }
      const key = slideKey(payload.projectId, payload.pageIndex)
      if (generatingSlides.has(key)) {
        return { success: false, error: '该页正在生成中，请稍候' }
      }
      generatingSlides.add(key)
      try {
        const content = getContent(payload.projectId)
        const pagesJson = content?.pagesJson
        if (!pagesJson) {
          return { success: false, error: '该项目还没有分页数据，无法生成幻灯片' }
        }
        let pages: PageSlide[]
        try {
          pages = JSON.parse(pagesJson) as PageSlide[]
        } catch {
          return { success: false, error: '分页数据损坏，无法解析' }
        }
        const page = pages[payload.pageIndex]
        if (!page) {
          return { success: false, error: `页索引越界：${payload.pageIndex}` }
        }

        const config = readLLMConfig()

        // 取上一页已生成的 elements 作为风格参考（若有）
        let prevElements: unknown[] | null = null
        if (payload.pageIndex > 0 && content?.excalidrawJson) {
          try {
            const allSlides = JSON.parse(content.excalidrawJson) as ExcalidrawPage[]
            const prev = allSlides.find((s) => s.pageIndex === payload.pageIndex - 1)
            if (prev && Array.isArray(prev.elements) && prev.elements.length > 0) {
              prevElements = prev.elements
            }
          } catch {
            /* ignore, 无参考即可 */
          }
        }
        const prompt = buildSlidePrompt(page, pages, payload.pageIndex, prevElements, payload.hint)

        const win = BrowserWindow.fromWebContents(event.sender)
        const pushStatus = (status: 'streaming' | 'ready'): void => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('llm:slideStatus', {
              projectId: payload.projectId,
              pageIndex: payload.pageIndex,
              status
            })
          }
        }
        pushStatus('streaming')

        let elements: unknown[]
        try {
          const raw = await streamLLM(prompt, config, () => {}, {
            temperature: 0.8,
            timeoutMs: 600000
          })
          elements = parseSlideElements(raw)
        } catch (err) {
          console.warn('[llm:generateSlide] 降级:', (err as Error).message)
          elements = fallbackSlideElements(page)
        }

        const slidePage: ExcalidrawPage = {
          pageIndex: payload.pageIndex,
          elements,
          appState: { viewBackgroundColor: '#ffffff' }
        }
        await upsertSlidePage(payload.projectId, slidePage)
        pushStatus('ready')
        return { success: true, data: slidePage }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      } finally {
        generatingSlides.delete(key)
      }
    }
  )

  /**
   * 串行为项目全部页面生成 Excalidraw JSON。
   * 每生成一页通过 'llm:slideReady' 事件推送 { projectId, pageIndex } 到 renderer。
   */
  ipcMain.handle(
    'llm:generateAllSlides',
    async (
      event,
      payload: { projectId: number; hint?: string }
    ): Promise<IpcResult<GenerateAllSlidesResult>> => {
      // 同一项目已在生成中，静默忽略重复提交
      if (generatingProjects.has(payload.projectId)) {
        return { success: true, data: { alreadyRunning: true } }
      }
      generatingProjects.add(payload.projectId)
      try {
        const content = getContent(payload.projectId)
        const pagesJson = content?.pagesJson
        if (!pagesJson) {
          return { success: false, error: '该项目还没有分页数据，无法生成幻灯片' }
        }
        let pages: PageSlide[]
        try {
          pages = JSON.parse(pagesJson) as PageSlide[]
        } catch {
          return { success: false, error: '分页数据损坏，无法解析' }
        }

        const config = readLLMConfig()
        const win = BrowserWindow.fromWebContents(event.sender)
        const sendStatus = (pageIndex: number, status: 'queued' | 'streaming' | 'ready'): void => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('llm:slideStatus', {
              projectId: payload.projectId,
              pageIndex,
              status
            })
            // 兼容：完成时同时推旧事件
            if (status === 'ready') {
              win.webContents.send('llm:slideReady', {
                projectId: payload.projectId,
                pageIndex
              })
            }
          }
        }

        // 所有页面先进入排队态
        for (let i = 0; i < pages.length; i++) sendStatus(i, 'queued')

        // 串行生成：逐页产出，每一页把上一张的 elements 作为「风格参考」
        // 以保证整份演示配色/字号/版式节奏一致
        let prevElements: unknown[] | null = null
        for (let i = 0; i < pages.length; i++) {
          sendStatus(i, 'streaming')
          const page = pages[i]
          const prompt = buildSlidePrompt(page, pages, i, prevElements, payload.hint)

          let elements: unknown[]
          try {
            const raw = await streamLLM(prompt, config, () => {}, {
              temperature: 0.8,
              timeoutMs: 600000
            })
            elements = parseSlideElements(raw)
          } catch (err) {
            console.warn(`[llm:generateAllSlides] page ${i} 降级:`, (err as Error).message)
            elements = fallbackSlideElements(page)
          }

          await upsertSlidePage(payload.projectId, {
            pageIndex: i,
            elements,
            appState: { viewBackgroundColor: '#ffffff' }
          })
          sendStatus(i, 'ready')
          prevElements = elements
        }

        return { success: true, data: {} }
      } catch (e) {
        return { success: false, error: (e as Error).message || String(e) }
      } finally {
        generatingProjects.delete(payload.projectId)
      }
    }
  )
}
