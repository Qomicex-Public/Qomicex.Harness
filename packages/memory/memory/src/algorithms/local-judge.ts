/**
 * The local judgment model: FunctionGemma behind node-llama-cpp.
 *
 * The whole point of the {@link LocalJudge} seam was that a real model could be
 * attached without disturbing the rule path, and this is that attachment. The
 * runtime is loaded lazily and dynamically, because `node-llama-cpp` is an
 * *optional* dependency: a tree without it must still load the memory plugin
 * and still judge, it just judges with the rule fallback instead.
 *
 * Three properties this file holds to:
 *
 * - **Judgment stays local.** Nothing here calls out to a network service. The
 *   only remote thing in the system is the optional model download, and it is
 *   an explicit user action, not something a judgment triggers.
 * - **A failure is a fallback, never an error.** A missing runtime, a missing
 *   model file, an unparseable answer, a timeout — every one of them returns
 *   `undefined`, and the caller degrades to the rule path. The model is an
 *   enhancement to a decision that already has a correct default.
 * - **The model does not decide what was said.** It returns a verdict and a
 *   confidence; the source class, epistemic status, and tier all stay with the
 *   rule path, so a model that misreads a sentence cannot promote an agent
 *   inference into a user statement.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/local-judge
 */

import { Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { JudgmentInput, JudgmentResult, LocalJudge } from './judgment.ts'
import type { JudgmentVerdict } from '../types.ts'

/** The prompt version, stamped so a trainer can tell which prompt produced a row. */
export const JUDGE_PROMPT_VERSION = 'v1'

/**
 * The default judge model: the llama.cpp conversion of FunctionGemma 270M.
 *
 * The weights come from `ggml-org/functiongemma-270m-it-GGUF`, not from
 * `google/functiongemma-270m-it`, because node-llama-cpp loads GGUF and the
 * upstream repo ships neither GGUF nor ungated access — its files are
 * safetensors plus one `.litertlm`, behind a manual license gate. Pinned to a
 * commit revision so the download is reproducible and a silent upstream
 * re-quantization cannot change what the judge runs.
 */
export const JUDGE_MODEL_REPO = 'ggml-org/functiongemma-270m-it-GGUF'
/** Commit revision the model URL is pinned to. */
export const JUDGE_MODEL_REVISION = '2566ce14aedfc14fdd0de955ba67346425e67126'
/** The quantized weights: 8-bit, near-BF16 quality at half the file size. */
export const JUDGE_MODEL_FILE = 'functiongemma-270m-it-q8_0.gguf'
/** The pinned download URL. */
export const JUDGE_MODEL_URL = `https://huggingface.co/${JUDGE_MODEL_REPO}/resolve/${JUDGE_MODEL_REVISION}/${JUDGE_MODEL_FILE}`
/** The version label stamped on judgment rows when the config leaves it empty. */
export const JUDGE_MODEL_VERSION = `${JUDGE_MODEL_FILE}@${JUDGE_MODEL_REVISION.slice(0, 8)}`

/** The instruction block, matching the design document's judgment prompt. */
export const JUDGE_SYSTEM_PROMPT = [
  '判断以下内容是否值得跨会话保留。',
  '',
  '值得记：项目事实、用户偏好、用户纠正、决策点、错误与解决方法、经验教训、结构性约束',
  '不值得记：一次性问题、闲聊、确认性回复、已过时信息、可从代码推导的信息、纯任务状态',
  '',
  '只返回 JSON，不要解释：',
  '{"shouldRemember": true | false, "confidence": 0.0-1.0, "rationale": "简短理由"}',
].join('\n')

/**
 * Build the user turn the model is asked to judge.
 *
 * Hints and context are both included, and neither is allowed to decide: the
 * hint says *why the rules flagged this*, the context says *what came before*,
 * and the verdict is still the model's. A hint is prefixed rather than
 * described so the model sees it as a tag rather than as an instruction.
 * @param input - The statement, its context, and its hints.
 * @returns The rendered prompt.
 */
export function buildJudgePrompt(input: JudgmentInput): string {
  const hints = input.hints.length > 0 ? `[规则 hint: ${input.hints.join(', ')}]\n` : ''
  const context = input.context.length > 0
    ? `[上下文]\n${input.context.map(line => `- ${line}`).join('\n')}\n`
    : ''
  return `${hints}${context}[内容]\n${input.current}`
}

/**
 * Parse one model answer into a verdict.
 *
 * Models wrap JSON in prose and fences even when told not to, so the parser
 * looks for the first balanced object rather than trusting the whole string.
 * Anything unparseable, or missing a boolean `shouldRemember`, returns
 * `undefined` — which the caller reads as "fall back to the rule path" rather
 * than as a verdict. Confidence is clamped because a model reporting `1.4`
 * means "very sure", not "surer than sure".
 * @param text - The raw model output.
 * @returns The verdict, or `undefined` when the answer is unusable.
 */
export function parseJudgeVerdict(text: string): JudgmentResult | undefined {
  const candidate = extractJsonObject(text)
  if (candidate === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as { shouldRemember?: unknown; confidence?: unknown }
  if (typeof record.shouldRemember !== 'boolean') return undefined
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0.5
  return {
    verdict: record.shouldRemember ? 'remember' : 'forget',
    confidence,
    source: 'local-llm',
  }
}

/** The first balanced `{...}` object in a string, or `undefined`. */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === undefined) break
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

/** What a loaded model can do: take a prompt, return text. */
export interface LoadedJudgeModel {
  /** Complete one prompt under the fixed judgment system prompt. */
  complete(prompt: string): Promise<string>
  /** Release the model and its context. */
  dispose(): Promise<void>
}

/** Loads a model from a path; the seam tests replace. */
export type JudgeModelLoader = (modelPath: string) => Promise<LoadedJudgeModel>

/** Options for the local judge. */
export interface LocalJudgeOptions {
  /** Path or URI of the GGUF model to load. */
  modelPath: string
  /** How many layers to offload to the GPU; `0` runs on CPU. */
  gpuLayers?: number
  /** Context size in tokens. */
  contextSize?: number
  /** The loader to use; defaults to node-llama-cpp. */
  loader?: JudgeModelLoader
}

/** Default context size; enough for the prompt plus a short JSON answer. */
export const DEFAULT_JUDGE_CONTEXT_SIZE = 2048

/**
 * The node-llama-cpp loader.
 *
 * Imported dynamically so a tree without the optional dependency still loads
 * this module: the failure surfaces here, at the point of use, where the
 * caller already handles it. The judgment system prompt is fixed, so it is
 * bound at construction rather than passed per call — a session is built
 * around one system prompt, and rebuilding it per statement would be the
 * expensive part.
 * @param modelPath - Path or URI of the GGUF model.
 * @param gpuLayers - Layers to offload; `0` runs on CPU.
 * @param contextSize - Context window in tokens.
 * @returns The loaded model.
 */
export async function loadLlamaCppModel(
  modelPath: string,
  gpuLayers = 0,
  contextSize: number = DEFAULT_JUDGE_CONTEXT_SIZE,
): Promise<LoadedJudgeModel> {
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp')
  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath, gpuLayers })
  const context = await model.createContext({ contextSize })
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: JUDGE_SYSTEM_PROMPT,
  })
  return {
    async complete(prompt: string): Promise<string> {
      return session.prompt(prompt)
    },
    async dispose(): Promise<void> {
      // The session releases synchronously; the context and model own the
      // native handles and are the part worth awaiting.
      session.dispose()
      await context.dispose()
      await model.dispose()
    },
  }
}

/**
 * The local judge: FunctionGemma behind node-llama-cpp.
 *
 * The model is loaded on the first judgment and kept for the session, because
 * loading is the expensive part and re-loading per message would put seconds
 * of latency on the capture path. A load failure is remembered as "unavailable"
 * rather than retried per message, so a misconfigured path costs one attempt
 * instead of one per statement.
 */
export class LlamaCppJudge implements LocalJudge {
  private readonly options: LocalJudgeOptions
  private loaded: LoadedJudgeModel | undefined
  private unavailable = false

  /** @param options - Model path, offload, and the loader seam. */
  constructor(options: LocalJudgeOptions) {
    this.options = options
  }

  /**
   * Judge one statement.
   * @param input - The statement, its context, and its hints.
   * @returns The verdict, or `undefined` to fall back to the rule path.
   */
  async judge(input: JudgmentInput): Promise<JudgmentResult | undefined> {
    if (this.unavailable) return undefined
    try {
      const model = await this.ensureLoaded()
      if (model === undefined) return undefined
      const answer = await model.complete(buildJudgePrompt(input))
      return parseJudgeVerdict(answer)
    } catch {
      // Containment over diagnosis: a model that throws once is treated as
      // unavailable rather than retried, and the rule path decides instead.
      this.unavailable = true
      await this.dispose()
      return undefined
    }
  }

  /** Release the model. */
  async dispose(): Promise<void> {
    const model = this.loaded
    this.loaded = undefined
    if (model === undefined) return
    try {
      await model.dispose()
    } catch {
      // Disposal is best-effort: a model that failed to load may also fail to
      // release, and nothing downstream depends on it.
    }
  }

  /** Load the model once, marking the judge unavailable if that fails. */
  private async ensureLoaded(): Promise<LoadedJudgeModel | undefined> {
    if (this.loaded !== undefined) return this.loaded
    const loader = this.options.loader
      ?? ((path: string) => loadLlamaCppModel(path, this.options.gpuLayers, this.options.contextSize))
    try {
      this.loaded = await loader(this.options.modelPath)
      return this.loaded
    } catch {
      this.unavailable = true
      return undefined
    }
  }
}

/** The verdict a boolean answer maps to; exported so tests read one name. */
export function verdictOf(shouldRemember: boolean): JudgmentVerdict {
  return shouldRemember ? 'remember' : 'forget'
}

/**
 * Download the default judge model to a path.
 *
 * Streamed into a `.part` sibling and renamed on completion, so an interrupted
 * download cannot leave a truncated GGUF behind — that is the failure a
 * rename-in-place would produce, and it would surface later as a model that
 * fails to load with nothing to say why. A response that is not `ok`, or that
 * carries no body, throws rather than writing an empty file.
 * @param target - Destination path for the GGUF file.
 * @param url - Source URL; defaults to the pinned FunctionGemma quant.
 * @returns The path written.
 */
export async function downloadJudgeModel(target: string, url: string = JUDGE_MODEL_URL): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`judge model download failed: HTTP ${response.status} from ${url}`)
  const body = response.body
  if (body === null) throw new Error('judge model download failed: empty response body')
  await mkdir(dirname(target), { recursive: true })
  const part = `${target}.part`
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
      .pipe(createWriteStream(part))
      .on('finish', () => {
        resolve()
      })
      .on('error', reject)
  })
  if ((await stat(part)).size === 0) {
    throw new Error('judge model download failed: zero bytes written')
  }
  await rename(part, target)
  return target
}

/**
 * Fetch the judge model when it is missing and automatic download is on.
 *
 * Deliberately separate from {@link LlamaCppJudge}: the judge has to stay able
 * to answer without a network, so the download cannot be a step inside a
 * judgment. This is a mount-time repair job — it downloads at most once, and a
 * failure is reported rather than thrown, because a plugin whose local model
 * is missing still judges, with the rule path.
 * @param modelPath - Where the model belongs; empty means there is nowhere to put it.
 * @param onError - Failure reporter.
 * @returns resolution after the attempt, whether or not it downloaded.
 */
export async function ensureJudgeModel(
  modelPath: string,
  onError: (error: unknown) => void,
): Promise<void> {
  if (modelPath === '') {
    onError(new Error('autoDownload needs a modelPath to download into'))
    return
  }
  try {
    if ((await stat(modelPath)).size > 0) return
  } catch {
    // Not there yet: fall through and fetch it.
  }
  try {
    await downloadJudgeModel(modelPath)
  } catch (error) {
    onError(error)
  }
}
