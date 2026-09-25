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
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

import type { JudgmentInput, JudgmentResult, LocalJudge } from './judgment.ts'
import type { JudgmentVerdict } from '../types.ts'

/** The prompt version, stamped so a trainer can tell which prompt produced a row. */
export const JUDGE_PROMPT_VERSION = 'v1'

/**
 * Where the judge model comes from.
 *
 * A release asset on `Qomicex-Public/Qomicex.Harness-memory`, reached through
 * whichever mirror answers fastest. The model is a 278 MB binary produced by
 * fine-tuning `google/functiongemma-270m-it`, so it lives in its own repo
 * rather than in the source tree — a clone should not pay for weights.
 */
export const JUDGE_MODEL_REPO = 'Qomicex-Public/Qomicex.Harness-memory'
/** Release tag the asset is published under. */
export const JUDGE_MODEL_TAG = 'v1.0.0'
/** The quantized weights: Q8_0, 278 MiB. */
export const JUDGE_MODEL_FILE = 'functiongemma-judge-q8_0.gguf'
/**
 * The direct release URL.
 *
 * Kept as the fallback: every mirror is this URL with a prefix, so if they all
 * fail the direct one is still a candidate rather than a special case.
 */
export const JUDGE_MODEL_URL = `https://github.com/${JUDGE_MODEL_REPO}/releases/download/${JUDGE_MODEL_TAG}/${JUDGE_MODEL_FILE}`
/**
 * Mirrors tried before the direct URL.
 *
 * Ordered by nothing in particular: the download measures them rather than
 * trusting this order, because which one is fastest depends on where the
 * machine is and what time of day it is.
 */
export const JUDGE_MODEL_PROXIES: readonly string[] = [
  'https://edgeone.gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  'https://hk.gh-proxy.org/',
  'https://v6.gh-proxy.org/',
  'https://ghfast.top/',
]
/** Version label stamped on judgment rows when the config leaves it empty. */
export const JUDGE_MODEL_VERSION = JUDGE_MODEL_TAG
/**
 * Where the model lands when the config names no path.
 *
 * The harness home rather than the workspace: the weights are a machine-wide
 * asset, and putting them in one project would download 278 MB again for every
 * other workspace that enables the judge.
 */
export const DEFAULT_JUDGE_MODEL_PATH = join(dshHomePath('models'), JUDGE_MODEL_FILE)

/**
 * The `developer` turn's content.
 *
 * English on purpose: measured with Chinese wording the model never emits a
 * call at all (0/4 in the zero-shot probe), while this exact string is the one
 * its function-calling training used. Not a stylistic choice.
 */
export const JUDGE_DEVELOPER_PROMPT
  = 'You are a model that can do function calling with the following functions'

/**
 * The function the model is asked to call, in FunctionGemma's own declaration
 * syntax — `declaration:name{description:<escape>…<escape>,parameters:{…}}`.
 *
 * Not JSON: FunctionGemma does not read a JSON tool schema, and handing it one
 * is why the judge never produced a verdict before. `shouldRemember` is a
 * BOOLEAN and `rationale` a STRING, matching what the LoRA fine-tune was
 * trained to emit.
 */
export const JUDGE_FUNCTION_DECLARATION = 'declaration:judge_statement'
  + '{description:<escape>判断一段内容是否值得跨会话保留。<escape>'
  + ',parameters:{type:<escape>OBJECT<escape>,properties:{'
  + 'shouldRemember:{type:<escape>BOOLEAN<escape>,description:<escape>是否值得保留<escape>}'
  + ',rationale:{type:<escape>STRING<escape>,description:<escape>简短理由<escape>}}}}'

/** Marker opening the function-declaration block. */
const DECLARATION_OPEN = '<start_function_declaration>'
/** Marker closing the function-declaration block. */
const DECLARATION_CLOSE = '<end_function_declaration>'
/** Marker opening a model's function call. */
export const FUNCTION_CALL_OPEN = '<start_function_call>'
/** Marker closing a model's function call. */
export const FUNCTION_CALL_CLOSE = '<end_function_call>'

/**
 * Render one statement as a complete FunctionGemma conversation.
 *
 * The whole template is written out here rather than handed to a chat wrapper:
 * the model was fine-tuned against exactly this byte sequence, and any wrapper
 * that re-formats it (role names, spacing, added turns) changes what the model
 * sees. `<escape>` wraps string values and the boolean is left bare — the
 * asymmetry is what the training data used.
 * @param content - The statement to judge.
 * @returns The rendered prompt.
 */
export function buildJudgePrompt(content: string): string {
  return '<bos><start_of_turn>developer\n'
    + `${JUDGE_DEVELOPER_PROMPT}\n`
    + `${DECLARATION_OPEN}${JUDGE_FUNCTION_DECLARATION}${DECLARATION_CLOSE}\n`
    + '<end_of_turn>\n'
    + '<start_of_turn>user\n'
    + `${content}\n`
    + '<end_of_turn>\n'
    + '<start_of_turn>model\n'
}

/**
 * Parse one model answer into a verdict.
 *
 * The answer is a FunctionGemma function call, not JSON:
 *
 * ```text
 * <start_function_call>call:judge_statement{shouldRemember:true,rationale:<escape>理由<escape>}<end_function_call>
 * ```
 *
 * A JSON parse would find `{shouldRemember:true,…}` and reject it — unquoted
 * keys are not JSON — which is exactly the silent drop that used to send every
 * statement down the rule path. Anything without a boolean `shouldRemember`
 * returns `undefined`, which the caller reads as "fall back to the rule path".
 * @param text - The raw model output.
 * @returns The verdict, or `undefined` when the answer is unusable.
 */
export function parseJudgeVerdict(text: string): JudgmentResult | undefined {
  const call = text.indexOf(FUNCTION_CALL_OPEN)
  if (call < 0) return undefined
  const body = text.slice(call + FUNCTION_CALL_OPEN.length)
  const close = body.indexOf(FUNCTION_CALL_CLOSE)
  const args = close < 0 ? body : body.slice(0, close)
  const verdict = /shouldRemember\s*:\s*(true|false)/.exec(args)
  if (verdict === null) return undefined
  return {
    verdict: verdict[1] === 'true' ? 'remember' : 'forget',
    confidence: CONFIDENCE_WHEN_UNSTATED,
    source: 'local-llm',
  }
}

/**
 * Confidence recorded when the model states none.
 *
 * The fine-tuned model answers with a bare boolean and no score, and inventing
 * one would be worse than admitting it is absent: the row is training data, and
 * a fabricated number would teach the next model something untrue.
 */
const CONFIDENCE_WHEN_UNSTATED = 0.5



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
 * Layers offloaded by default.
 *
 * Every layer, because the model is 272 MiB and even a laptop GPU holds it
 * whole; a partial offload would split the compute graph for no gain. Measured
 * safe on a machine with no GPU: llama.cpp silently ignores the request and
 * runs on CPU, so this needs no detection to stay correct.
 */
export const ALL_GPU_LAYERS = 99

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
  const { getLlama, LlamaCompletion } = await import('node-llama-cpp')
  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath, gpuLayers })
  const context = await model.createContext({ contextSize })
  return {
    async complete(prompt: string): Promise<string> {
      // parseSpecial=true is load-bearing. The prompt is a fully rendered
      // FunctionGemma conversation, and with the default (false) the structural
      // markers — <start_of_turn>, <end_of_turn>, <escape> — are ordinary text
      // that gets BPE-split, so the model sees a scrambled conversation and
      // answers nothing. Measured: 14.7% of statements got a verdict with
      // `false`, 100% with `true`.
      const ids = model.tokenize(prompt, true)
      const completion = new LlamaCompletion({
        contextSequence: context.getSequence(),
        autoDisposeSequence: true,
      })
      try {
        return await completion.generateCompletion(ids, {
          maxTokens: MAX_JUDGE_TOKENS,
          temperature: 0,
          customStopTriggers: ['<end_of_turn>', '<start_function_response>'],
        })
      } finally {
        completion.dispose()
      }
    },
    async dispose(): Promise<void> {
      // The context and model own the native handles and are the part worth
      // awaiting; the completion is per-call and already disposed above.
      await context.dispose()
      await model.dispose()
    },
  }
}

/** Tokens allowed for one verdict; the call is a sentence, not an essay. */
const MAX_JUDGE_TOKENS = 120

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
      const answer = await model.complete(buildJudgePrompt(input.current))
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

/**
 * A judge that builds its model on the first statement it is asked about.
 *
 * The settings page can enable the local model while the harness runs, and a
 * judge constructed at mount would have read the composition entry — which
 * ships disabled — so the edit would never take effect until a restart. Reading
 * the config at first use instead means the toggle applies immediately, which
 * is what the Settings page promises.
 *
 * A build that yields nothing (model off, or no path) is remembered: retrying
 * per statement would re-read the same config and reach the same answer.
 */
export class LazyJudge implements LocalJudge {
  private built: LocalJudge | undefined
  private absent = false

  /** @param build - Produces the judge, or `undefined` when it is not configured. */
  constructor(private readonly build: () => LocalJudge | undefined) {}

  /**
   * Judge one statement, building the model on first use.
   * @param input - The statement and its context.
   * @returns The verdict, or `undefined` to fall back to the rule path.
   */
  async judge(input: JudgmentInput): Promise<JudgmentResult | undefined> {
    if (this.absent) return undefined
    this.built ??= this.build()
    if (this.built === undefined) {
      this.absent = true
      return undefined
    }
    return this.built.judge(input)
  }

  /** Release the model, if one was ever built. */
  async dispose(): Promise<void> {
    const built = this.built as { dispose?: () => Promise<void> } | undefined
    this.built = undefined
    await built?.dispose?.()
  }
}

/**
 * The verdict a boolean answer maps to; exported so tests read one name.
 * @param shouldRemember - The judge's answer.
 * @returns `remember` when the answer is true, otherwise `forget`.
 */
export function verdictOf(shouldRemember: boolean): JudgmentVerdict {
  return shouldRemember ? 'remember' : 'forget'
}

/**
 * Every URL a download may try: the direct one first, then each mirror.
 *
 * Exported so the ordering is testable without a network call.
 * @param url - The direct URL.
 * @returns The candidates in preference order.
 */
export function judgeModelSources(url: string = JUDGE_MODEL_URL): string[] {
  return [url, ...JUDGE_MODEL_PROXIES.map(prefix => `${prefix}${url}`)]
}

/** Bytes fetched when timing a source: enough to measure a real transfer. */
const PROBE_BYTES = 256 * 1024

/** One source and how long it took to hand over the probe bytes. */
interface SourceTiming {
  readonly url: string
  readonly ms: number
}

/**
 * Time one source with a ranged request.
 *
 * A failure is `undefined` rather than a throw: a mirror that is down is a
 * normal outcome here, not an error, and the caller is choosing between
 * candidates rather than performing one download.
 * @param url - The candidate URL.
 * @returns The timing, or `undefined` when the source is unreachable.
 */
async function timeSource(url: string): Promise<SourceTiming | undefined> {
  const started = Date.now()
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } })
    if (!response.ok) return undefined
    // Drain the body: timing headers alone would rank a slow mirror first.
    const body = await response.arrayBuffer()
    if (body.byteLength === 0) return undefined
    return { url, ms: Date.now() - started }
  } catch {
    return undefined
  }
}

/**
 * Pick the fastest reachable source, falling back to the direct URL.
 *
 * Probed in parallel because a serial walk would make the user wait for every
 * dead mirror before reaching a working one. When nothing answers, the direct
 * URL is returned anyway — the caller's own download attempt then produces the
 * error message worth reading, instead of this function inventing one.
 * @param url - The direct URL.
 * @returns The URL to download from.
 */
export async function pickFastestSource(url: string = JUDGE_MODEL_URL): Promise<string> {
  const timings = await Promise.all(judgeModelSources(url).map(timeSource))
  const usable = timings.filter((timing): timing is SourceTiming => timing !== undefined)
  if (usable.length === 0) return url
  return usable.reduce((fastest, candidate) => (candidate.ms < fastest.ms ? candidate : fastest)).url
}

/** Progress of one download, in bytes. */
export interface DownloadProgress {
  /** Bytes written so far. */
  readonly received: number
  /** Total size when the server declared one; `0` when it did not. */
  readonly total: number
}

/**
 * Download the default judge model to a path.
 *
 * Streamed into a `.part` sibling and renamed on completion, so an interrupted
 * download cannot leave a truncated GGUF behind — that is the failure a
 * rename-in-place would produce, and it would surface later as a model that
 * fails to load with nothing to say why. A response that is not `ok`, or that
 * carries no body, throws rather than writing an empty file.
 *
 * The source is chosen by {@link pickFastestSource}: mirrors are tried and the
 * fastest one wins, with the direct URL as the last resort.
 * @param target - Destination path for the GGUF file.
 * @param url - The direct URL to fetch; mirrors are derived from it.
 * @param onProgress - Called as bytes land, so a caller can show a bar.
 * @returns The path written.
 */
export async function downloadJudgeModel(
  target: string,
  url: string = JUDGE_MODEL_URL,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const source = await pickFastestSource(url)
  const response = await fetch(source)
  if (!response.ok) throw new Error(`judge model download failed: HTTP ${response.status} from ${source}`)
  const body = response.body
  if (body === null) throw new Error('judge model download failed: empty response body')
  await mkdir(dirname(target), { recursive: true })
  const part = `${target}.part`
  const declared = Number(response.headers.get('content-length') ?? '0')
  const total = Number.isFinite(declared) ? declared : 0
  let received = 0
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
      .on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress?.({ received, total })
      })
      .pipe(createWriteStream(part))
      .on('finish', () => {
        resolve()
      })
      .on('error', reject)
  })
  onProgress?.({ received, total })
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
