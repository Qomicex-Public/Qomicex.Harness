/**
 * 独立验证脚本：FunctionGemma 零样本函数调用是否可用。
 *
 * 用途：不复用记忆插件任何代码，仅用 node-llama-cpp 加载本地 GGUF，
 * 按 FunctionGemma 原生对话模板手写提示词，观察基座模型能否产出
 * `<start_function_call>` 结构化调用。
 *
 * 运行：
 *   node --import tsx/esm verify-functiongemma.ts
 *
 * 判定标准（只看原理，不评准确率）：
 *   任一变体只要产出含 <start_function_call> 的文本，即说明零样本机制可用。
 */

import { getLlama, LlamaCompletion } from 'node-llama-cpp'

const MODEL_PATH = process.env.JUDGE_MODEL_PATH
  ?? `${process.env.USERPROFILE}/.qomicex/models/functiongemma-270m-it-q8_0.gguf`

/** 原生声明语法：declaration:name{description:<escape>..<escape>,parameters:{...}} */
const MEANINGFULNESS_DECLARATION = 'declaration:classify_meaningfulness'
  + '{description:<escape>判断输入文本是否有意义。返回 meaningful 或 meaningless。<escape>'
  + ',parameters:{type:<escape>OBJECT<escape>,properties:{'
  + 'text:{type:<escape>STRING<escape>,description:<escape>需要分类的文本<escape>}'
  + ',label:{type:<escape>STRING<escape>,enum:[<escape>meaningful<escape>,<escape>meaningless<escape>]'
  + ',description:<escape>分类结果<escape>}}}}'

/** 我们判断层真正需要的函数。 */
const JUDGE_DECLARATION = 'declaration:judge_statement'
  + '{description:<escape>判断一段内容是否值得跨会话保留。<escape>'
  + ',parameters:{type:<escape>OBJECT<escape>,properties:{'
  + 'shouldRemember:{type:<escape>BOOLEAN<escape>,description:<escape>是否值得保留<escape>}'
  + ',rationale:{type:<escape>STRING<escape>,description:<escape>简短理由<escape>}}}}'

const DEV_ZH = '你是一个可以使用以下函数进行函数调用的模型'
const DEV_EN = 'You are a model that can do function calling with the following functions'

/** 按原生模板拼一条完整提示词。 */
function buildPrompt(
  declaration: string,
  developer: string,
  text: string,
  withBos: boolean,
  guide: boolean,
): string {
  const bos = withBos ? '<bos>' : ''
  // 引导语只包住用户文本，不动 developer 与声明块——分享对话的原意是
  // 帮模型把当前任务和它见过的工具调用场景联系起来。
  const user = guide
    ? `请对以下文本进行分类，判断它是有意义的日常表达还是无意义的乱码：${text}`
    : text
  return `${bos}<start_of_turn>developer
${developer}
<start_function_declaration>${declaration}<end_function_declaration>
<end_of_turn>
<start_of_turn>user
${user}
<end_of_turn>
<start_of_turn>model`
}

const samples = [
  '这个项目的包管理器一律用 pnpm，不要用 npm。',
  '今天天气真好，我们出去散步吧。',
  'asdfghjkl123456!!!@@@###',
  'ls',
]

const variants = [
  { name: 'A 原生声明 + 中文 developer + <bos>', declaration: MEANINGFULNESS_DECLARATION, developer: DEV_ZH, withBos: true, guide: false },
  { name: 'B 原生声明 + 中文 developer，无 <bos>', declaration: MEANINGFULNESS_DECLARATION, developer: DEV_ZH, withBos: false, guide: false },
  { name: 'C 原生声明 + 英文 developer + <bos>', declaration: MEANINGFULNESS_DECLARATION, developer: DEV_EN, withBos: true, guide: false },
  { name: 'D 判断层函数 + 中文 developer + <bos>', declaration: JUDGE_DECLARATION, developer: DEV_ZH, withBos: true, guide: false },
  // 分享对话明确建议：在 user prompt 中加入少量引导，降低任务对模型的陌生感，
  // 属零样本提示工程，不涉及参数更新。上一轮漏测，这里补上。
  { name: 'E 原生声明 + 英文 developer + <bos> + user 引导语', declaration: MEANINGFULNESS_DECLARATION, developer: DEV_EN, withBos: true, guide: true },
  { name: 'F 判断层函数 + 英文 developer + <bos> + user 引导语', declaration: JUDGE_DECLARATION, developer: DEV_EN, withBos: true, guide: true },
]

const llama = await getLlama({ gpu: 'auto', logLevel: 'error' })
console.log('gpu:', llama.gpu)
console.log('model:', MODEL_PATH)
const model = await llama.loadModel({ modelPath: MODEL_PATH, gpuLayers: 99 })
const context = await model.createContext({ contextSize: 2048 })

let hits = 0
let total = 0

for (const variant of variants) {
  console.log(`\n${'='.repeat(70)}\n${variant.name}\n${'='.repeat(70)}`)
  for (const text of samples) {
    total += 1
    const at = Date.now()
    try {
      const completion = new LlamaCompletion({ contextSequence: context.getSequence(), autoDisposeSequence: true })
      const answer = await completion.generateCompletion(
        buildPrompt(variant.declaration, variant.developer, text, variant.withBos, variant.guide),
        {
          maxTokens: 150,
          temperature: 0,
          customStopTriggers: ['<end_of_turn>', '<start_function_response>'],
        },
      )
      completion.dispose()
      const hasCall = answer.includes('<start_function_call>')
      if (hasCall) hits += 1
      console.log(`\n[${Date.now() - at}ms] 输入: ${text}`)
      console.log(`  输出: ${JSON.stringify(answer.slice(0, 260))}`)
      console.log(`  >>> start_function_call: ${hasCall}`)
    } catch (error) {
      console.log(`\n[ERR] 输入: ${text} -> ${String(error).slice(0, 180)}`)
    }
  }
}

await context.dispose()
await model.dispose()

console.log(`\n${'='.repeat(70)}`)
console.log(`结果：${hits}/${total} 次产出 <start_function_call>`)
console.log(hits > 0 ? '结论：零样本函数调用机制可用' : '结论：零样本无法产出结构化调用')
console.log('='.repeat(70))
