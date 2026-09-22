/* 同基准对比：用 llama.cpp + GGUF 跑 eval_accuracy.py 用过的同一批留出样本。
 *
 * 训练后那次 129/129 是 transformers + Peft adapter 跑出来的；
 * verify-functiongemma.ts 的 11/24 是 llama.cpp + GGUF 跑 4 条固定文本 × 6 变体。
 * 两者测试集、运行时、函数定义都不同，不能直接比。这个脚本把运行时换成
 * llama.cpp + GGUF，测试集保持 129 条不变，才是同一基准。
 *
 * 运行：node --import tsx/esm eval_gguf.ts
 */

import { readFileSync, statSync } from 'node:fs'
import { getLlama, LlamaCompletion } from 'node-llama-cpp'

const GGUF = process.env.JUDGE_MODEL_PATH
  ?? 'C:/Project/FunctionGemma-MemJudger/functiongemma-judge.gguf'
const TEST_FILE = 'C:/Project/FunctionGemma-MemJudger/test.jsonl'

const DEV_EN = 'You are a model that can do function calling with the following functions'
const JUDGE_DECLARATION = 'declaration:judge_statement'
  + '{description:<escape>判断一段内容是否值得跨会话保留。<escape>'
  + ',parameters:{type:<escape>OBJECT<escape>,properties:{'
  + 'shouldRemember:{type:<escape>BOOLEAN<escape>,description:<escape>是否值得保留<escape>}'
  + ',rationale:{type:<escape>STRING<escape>,description:<escape>简短理由<escape>}}}}'

const BOOL_RE = /shouldRemember\s*:\s*(true|false)/

function buildPrompt(text) {
  return '<bos><start_of_turn>developer\n'
    + `${DEV_EN}\n`
    + `<start_function_declaration>${JUDGE_DECLARATION}<end_function_declaration>\n`
    + '<end_of_turn>\n<start_of_turn>user\n'
    + `${text}\n`
    + '<end_of_turn>\n<start_of_turn>model\n'
}

const rows = readFileSync(TEST_FILE, 'utf8')
  .split('\n').filter(line => line.trim() !== '')
  .map(line => JSON.parse(line))
console.log(`留出集 ${rows.length} 条，GGUF: ${GGUF}`)

const startedAt = Date.now()
const llama = await getLlama({ gpu: 'auto', logLevel: 'error' })
const model = await llama.loadModel({ modelPath: GGUF, gpuLayers: 99 })
const context = await model.createContext({ contextSize: 2048 })
const loadMs = Date.now() - startedAt

let produced = 0
let correct = 0
const mismatch = []

let totalMs = 0
for (const [index, row] of rows.entries()) {
  const sampleAt = Date.now()
  // 必须 parseSpecial=true：generateCompletion(字符串) 默认 false，
  // 会把提示词里的 <start_of_turn>/<escape> 当普通文本 BPE 拆碎，
  // 模型于是看到结构错乱的输入（实测产出率 14.7%）。
  const completion = new LlamaCompletion({
    contextSequence: context.getSequence(),
    autoDisposeSequence: true,
  })
  const promptIds = model.tokenize(buildPrompt(row.text), true)
  const answer = await completion.generateCompletion(promptIds, {
    maxTokens: 120,
    temperature: 0,
    customStopTriggers: ['<end_of_turn>', '<start_function_response>'],
  })
  completion.dispose()

  totalMs += Date.now() - sampleAt
  const match = BOOL_RE.exec(answer)
  if (!match) continue
  produced += 1
  const got = match[1] === 'true'
  if (got === row.shouldRemember) correct += 1
  else mismatch.push({ text: row.text, want: row.shouldRemember, got })

  if ((index + 1) % 30 === 0) {
    console.log(`  进度 ${index + 1}/${rows.length}  产出 ${produced} 判对 ${correct}`)
  }
}

await context.dispose()
await model.dispose()

console.log(`\n${'='.repeat(60)}`)
console.log('运行时        : llama.cpp + GGUF（F16）')
console.log(`布尔产出率    : ${produced}/${rows.length} = ${(produced / rows.length * 100).toFixed(1)}%`)
console.log(`一致率        : ${correct}/${rows.length} = ${(correct / rows.length * 100).toFixed(1)}%`)
console.log(`判错          : ${mismatch.length} 条`)
console.log('='.repeat(60))
console.log('对照：transformers + Peft adapter 在同一样本上为 129/129 产出、95/129 一致')
