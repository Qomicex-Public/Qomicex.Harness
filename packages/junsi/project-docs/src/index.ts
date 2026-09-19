/**
 * Project-docs tools for the DeepSeek Harness.
 *
 * Faithful adaptation of the junsi-dev-toolkit project-docs MCP server into a
 * native tool package. The Python MCP server depended on the external `mcp` and
 * `pydantic` packages and broke when the mcp SDK dropped `@app.list_tools()`.
 * This package re-registers the same twenty tools (bare names, no `mcp__`
 * prefix) over `node:fs` with zero external dependencies.
 *
 * The project root is derived from the calling session's workspace `cwd`
 * (the same source `dsh-tool-memory` uses), so scans and writes follow the
 * current session rather than the process launch directory.
 *
 * @module @deepseek-ai/dsh-tool-project-docs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']
export const name = 'tool-project-docs'

// ── 常量 ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  '1-决策记录',
  '2-架构设计',
  '3-API规范',
  '4-编码规范',
  '5-数据库设计',
  '6-UI/组件设计',
  '7-调用规范',
  '8-部署运维',
  '9-系统要求',
] as const

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.github', '.venv', 'venv',
  'dist', 'build', '__pycache__', '.idea', '.vscode',
])

const ROOT_META = new Set(['readme.md', 'agents.md', 'claude.md', 'codeowners'])
const ROOT_META_PREFIX = ['license', 'changelog', 'contributing', 'install',
  'code_of_conduct', 'security.md', 'support.md']

const CAT_KEYWORDS: Record<string, string[]> = {
  '1-决策记录': ['adr', '决策', 'decision record', 'architecture decision'],
  '2-架构设计': ['架构', 'architecture', '模块', 'module', 'subsystem',
    'overview', 'primer', 'design', '设计', 'lifecycle'],
  '3-API规范': ['api', '接口', 'endpoint', 'rpc', 'rest', 'gateway'],
  '4-编码规范': ['规范', 'convention', 'style guide', 'coding', 'guideline', 'lint'],
  '5-数据库设计': ['数据库', 'database', 'persistence', 'schema', 'sql', 'migration', '表结构'],
  '6-UI/组件设计': ['ui', '组件', 'component', 'css', 'theme', '样式', 'styling'],
  '7-调用规范': ['调用', 'invoke', '异常', 'error handling', '日志', 'logging', 'defensive'],
  '8-部署运维': ['部署', 'deploy', '运维', 'release', 'build', 'ci'],
  '9-系统要求': ['需求', 'requirement', 'tutorial', 'cookbook', 'guide', '教程',
    'glossary', 'user guide'],
}

const LANG_MAP: Record<string, string> = {
  '.cs': 'C#', '.rs': 'Rust', '.ts': 'TS', '.tsx': 'TSX',
  '.js': 'JS', '.mjs': 'JS', '.cjs': 'JS',
  '.py': 'Python', '.csproj': 'C#', '.sln': 'C#',
  '.json': 'JSON', '.toml': 'TOML', '.yaml': 'YAML', '.yml': 'YAML',
  '.css': 'CSS', '.html': 'HTML', '.xml': 'XML',
  '.md': 'Markdown',
}

const SZ = 500

interface Endpoint { method: string; route: string; file: string; kind: string }
interface Route { path: string; component?: string; file: string }
interface ComponentEntry { name: string; file: string; type: string }
interface NamedFile { name: string; file: string }
interface ApiCall { call: string; url: string; file: string }

// ── 基础 helper ───────────────────────────────────────────────────────

function projectRootOf(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd === 'string' && cwd.length) return cwd
  return process.cwd() || '.'
}

function docsRootOf(root: string): string {
  return path.join(root, 'docs', 'junsi-dev-docs')
}

function indexFileOf(root: string): string {
  return path.join(docsRootOf(root), 'docs-index.json')
}

function docsScanRootOf(root: string): string {
  return path.join(root, 'docs')
}

async function readText(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return ''
  }
}

async function writeText(p: string, content: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, content, 'utf8')
    return true
  } catch {
    return false
  }
}

function safeRelative(p: string, base: string): string {
  const rel = path.relative(base, p)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return p
  return rel.replace(/\\/g, '/')
}

function trunc(text: string, maxChars: number = SZ): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n... (truncated)`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function nowStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nowDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function normList(x: unknown): string[] {
  if (!x) return []
  if (typeof x === 'string') {
    return x.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  }
  if (Array.isArray(x)) {
    return x.map(s => String(s).trim().toLowerCase()).filter(Boolean)
  }
  return []
}

function asList(x: unknown): string[] {
  if (!x) return []
  if (typeof x === 'string') {
    return x.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
  }
  if (Array.isArray(x)) {
    return x.map(s => String(s).trim()).filter(Boolean)
  }
  return []
}

function fileLang(p: string): string {
  const ext = path.extname(p).toLowerCase()
  return LANG_MAP[ext] ?? ''
}

function fileLayer(p: string): string {
  const pp = p.replace(/\\/g, '/')
  if (pp.includes('/src-tauri/')) return 'Tauri(Rust)'
  if (pp.includes('/src-backend/')) return 'Backend(C#)'
  if (pp.includes('/src/')) return 'Frontend(TS)'
  if (pp.includes('/docs/')) return 'Docs'
  return ''
}

function tag(p: string): string {
  const lang = fileLang(p)
  const layer = fileLayer(p)
  const tags = [lang ? `[${lang}]` : '', layer].filter(Boolean).join(' ')
  return tags ? `${tags} ${p}` : p
}

async function walkFiles(dir: string, exts: string[], out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue
      await walkFiles(path.join(dir, e.name), exts, out)
    } else if (!e.isSymbolicLink()) {
      const ext = path.extname(e.name).toLowerCase()
      if (exts.includes(ext)) out.push(path.join(dir, e.name))
    }
  }
  return out
}

// ── 文档扫描 / 索引 / 标签 ────────────────────────────────────────────

function isRootMeta(name: string): boolean {
  const n = name.toLowerCase()
  return ROOT_META.has(n) || ROOT_META_PREFIX.some(p => n.startsWith(p))
}

async function docTitle(fp: string): Promise<string> {
  const content = await readText(fp)
  const m = content.match(/^#\s+(.+)$/m)
  return m?.[1]?.trim() ?? path.basename(fp, '.md')
}

async function iterMd(dir: string, recursive: boolean): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (recursive && !IGNORE_DIRS.has(e.name)) {
        out.push(...await iterMd(full, true))
      }
    } else if (!e.isSymbolicLink() && e.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

async function readIndex(root: string): Promise<Record<string, unknown>> {
  const idx = indexFileOf(root)
  try {
    const parsed = JSON.parse(await readText(idx)) as Record<string, unknown>
    return parsed
  } catch {
    return {}
  }
}

interface DocEntry {
  path: string
  id?: string | null | undefined
  external?: boolean | undefined
  title?: string | undefined
  original_path?: string | null | undefined
  explicit_tags?: string[] | undefined
  zh?: string | null | undefined
  i18n?: string | null | undefined
  schema?: string | null | undefined
  tags?: string[] | undefined
}

function docsOf(index: Record<string, unknown>): DocEntry[] {
  const arr = index.docs
  if (!Array.isArray(arr)) return []
  return arr.filter((d): d is DocEntry => typeof d === 'object' && d !== null && typeof (d as DocEntry).path === 'string')
}

function externalPaths(index: Record<string, unknown>): Array<{ id?: string; path: string }> {
  const arr = index.paths
  if (!Array.isArray(arr)) return []
  return arr.filter((p): p is { id?: string; path: string } =>
    typeof p === 'object' && p !== null && typeof (p as { path?: unknown }).path === 'string')
}

function pathTags(p: string): string[] {
  let rest = p.replace(/\\/g, '/')
  if (rest.startsWith('docs/junsi-dev-docs/')) rest = rest.slice('docs/junsi-dev-docs/'.length)
  else if (rest.startsWith('docs/')) rest = rest.slice('docs/'.length)
  const out: string[] = []
  for (const seg of rest.split('/').slice(0, -1)) {
    const s = seg.trim().toLowerCase()
    if (s && s !== 'junsi-dev-docs') out.push(s)
  }
  return out
}

function docTags(d: DocEntry): string[] {
  const src = d.original_path ?? d.path
  return [...new Set([...pathTags(src), ...normList(d.explicit_tags)])]
}

function recomputeTags(index: Record<string, unknown>): void {
  const tagMap: Record<string, string[]> = {}
  for (const d of docsOf(index)) {
    d.tags = docTags(d)
    for (const t of d.tags) {
      ;(tagMap[t] ??= []).push(d.path)
    }
  }
  index.tags = tagMap
}

function companionBaseName(name: string): string | null {
  for (const suf of ['.zh.md', '.i18n.yaml', '.schema.json'] as const) {
    if (name.endsWith(suf)) return name.slice(0, -suf.length) + '.md'
  }
  return null
}

async function scanUnits(
  root: string,
  roots?: string[],
  includeRoot: boolean = true,
  paths?: Array<{ id?: string; path: string }>,
): Promise<DocEntry[]> {
  const docRoot = docsRootOf(root)
  const projRoot = root
  const external = paths ?? externalPaths(await readIndex(root))

  const mdFiles: string[] = await iterMd(docsScanRootOf(root), true)
  if (includeRoot) mdFiles.push(...await iterMd(projRoot, false))
  for (const r of roots ?? []) {
    mdFiles.push(...await iterMd(path.join(projRoot, r.replace(/\//g, path.sep)), true))
  }

  const entryIds = new Map<string, string>()
  const registered = new Set<string>()
  for (const entry of external) {
    const base = path.join(projRoot, entry.path.replace(/\//g, path.sep))
    let exists = false
    try {
      await fs.access(base)
      exists = true
    } catch {}
    if (!exists) continue
    const st = await fs.stat(base)
    if (st.isFile()) {
      if (path.extname(base).toLowerCase() === '.md') {
        mdFiles.push(base)
        registered.add(path.resolve(base))
        if (entry.id) entryIds.set(path.resolve(base), entry.id)
      }
      continue
    }
    for (const fp of await iterMd(base, true)) {
      mdFiles.push(fp)
      registered.add(path.resolve(fp))
    }
  }

  const indexResolved = path.resolve(indexFileOf(root))
  const seen = new Set<string>()
  const primaries: string[] = []
  for (const fp of mdFiles) {
    const key = path.resolve(fp)
    if (seen.has(key)) continue
    seen.add(key)
    if (key === indexResolved) continue
    if (path.basename(fp).toLowerCase() === 'readme.md' && path.resolve(path.dirname(fp)) === path.resolve(docRoot)) continue
    if (path.basename(fp).endsWith('.zh.md')) {
      const baseName = companionBaseName(path.basename(fp))
      if (baseName) {
        const candidate = path.join(path.dirname(fp), baseName)
        try {
          await fs.access(candidate)
          continue
        } catch {}
      }
    }
    primaries.push(fp)
  }

  const units: DocEntry[] = []
  for (const fp of primaries) {
    if (path.resolve(path.dirname(fp)) === path.resolve(projRoot) && isRootMeta(path.basename(fp))) continue
    const rel = safeRelative(fp, projRoot)
    const isExternal = registered.has(path.resolve(fp))
    const uid = isExternal ? (entryIds.get(path.resolve(fp)) ?? slugOf(rel)) : null
    const nameOf = path.basename(fp)
    const stem = nameOf.endsWith('.zh.md') ? null : nameOf.slice(0, -3)
    let zh: string | null = null
    let i18n: string | null = null
    let schema: string | null = null
    if (stem) {
      for (const [suf, key] of [['.zh.md', 'zh'], ['.i18n.yaml', 'i18n'], ['.schema.json', 'schema']] as const) {
        const cand = path.join(path.dirname(fp), stem + suf)
        try {
          await fs.access(cand)
          const val = safeRelative(cand, projRoot)
          if (key === 'zh') zh = val
          else if (key === 'i18n') i18n = val
          else schema = val
        } catch {}
      }
    }
    units.push({
      path: rel,
      id: uid,
      external: isExternal,
      title: await docTitle(fp),
      zh, i18n, schema,
    })
  }
  return units
}

async function buildIndex(
  root: string,
  roots?: string[],
  includeRoot: boolean = true,
  paths?: Array<{ id?: string; path: string }>,
): Promise<Record<string, unknown>> {
  const old = new Map(docsOf(await readIndex(root)).map(d => [d.path, d]))
  const lookup = await indexLookup(root)
  const reg = paths ?? externalPaths(await readIndex(root))
  const index: Record<string, unknown> = { version: 2, updated: nowStamp(), paths: reg, docs: [] }
  const docs: DocEntry[] = []
  const seen = new Set<string>()
  for (const u of await scanUnits(root, roots, includeRoot, reg)) {
    seen.add(u.path)
    let prev: DocEntry | undefined
    if (u.id) prev = lookup.get(`id:${u.id}`)
    if (!prev) prev = old.get(u.path)
    docs.push({
      path: u.path,
      id: u.id,
      external: u.external ?? false,
      title: u.title,
      original_path: prev?.original_path,
      explicit_tags: prev?.explicit_tags ?? [],
      zh: u.zh, i18n: u.i18n, schema: u.schema,
    })
  }
  for (const [p, d] of old) {
    if (seen.has(p)) continue
    try {
      await fs.access(path.join(root, p.replace(/\//g, path.sep)))
      docs.push(d)
    } catch {}
  }
  docs.sort((a, b) => a.path.localeCompare(b.path))
  index.docs = docs
  recomputeTags(index)
  return index
}

async function indexLookup(root: string): Promise<Map<string, DocEntry>> {
  const out = new Map<string, DocEntry>()
  for (const d of docsOf(await readIndex(root))) {
    if (d.id) out.set(`id:${d.id}`, d)
    out.set(`path:${d.path}`, d)
  }
  return out
}

async function saveIndex(root: string, index: Record<string, unknown>): Promise<void> {
  index.updated = nowStamp()
  await writeText(indexFileOf(root), JSON.stringify(index, null, 2))
  await updateReadme(root, index)
}

function suggestCategory(p: string, title: string, content: string): string | null {
  const hay = `${p} ${title} ${content.slice(0, 4000)}`.toLowerCase()
  let best: string | null = null
  let score = 0
  for (const [cat, kws] of Object.entries(CAT_KEYWORDS)) {
    const s = kws.reduce((acc, k) => acc + (hay.split(k).length - 1), 0)
    if (s > score) {
      best = cat
      score = s
    }
  }
  return best
}

async function searchDocs(
  root: string,
  keywords: string,
  category?: string,
  tags?: string[],
): Promise<Array<Record<string, unknown>>> {
  const lookup = await indexLookup(root)
  const want = normList(tags)
  const terms = (keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  const results: Array<Record<string, unknown>> = []
  for (const u of await scanUnits(root)) {
    const rel = u.path
    if (category && !rel.startsWith(`docs/junsi-dev-docs/${category}/`)) continue
    let prev = u.id ? lookup.get(`id:${u.id}`) : undefined
    if (!prev) prev = lookup.get(`path:${rel}`)
    const d = { path: rel, original_path: prev?.original_path, explicit_tags: prev?.explicit_tags ?? [] }
    const dTags = docTags(d)
    if (want.length && !want.every(t => dTags.includes(t))) continue
    const body = await readText(path.join(root, rel))
    if (terms.length && !terms.every(t => `${body}\n${u.title}`.toLowerCase().includes(t))) continue
    results.push({
      path: rel, id: u.id, title: u.title, tags: dTags,
      original_path: d.original_path, external: u.external ?? false,
      summary: `${body.slice(0, 200).replace(/\n/g, ' ')}...`,
    })
    if (results.length >= 20) break
  }
  return results.slice(0, 20)
}

// ── 归档 / 回滚 ──────────────────────────────────────────────────────

function slugOf(p: string): string {
  const pp = p.replace(/\\/g, '/')
  let rel = pp.startsWith('docs/') ? pp.slice('docs/'.length) : pp
  if (rel.endsWith('.md')) rel = rel.slice(0, -3)
  return rel.replace(/\//g, '--')
}

async function moveFile(src: string, dest: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    try {
      await fs.access(dest)
      return false
    } catch {}
    await fs.rename(src, dest)
    return true
  } catch {
    return false
  }
}

function parseAssignments(assignments: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!assignments) return out
  const items: Array<{ path: string; category: string }> = []
  if (Array.isArray(assignments)) {
    for (const a of assignments) {
      if (typeof a === 'object' && a !== null) {
        const a2 = a as { path?: unknown; category?: unknown }
        items.push({ path: typeof a2.path === 'string' ? a2.path : '', category: typeof a2.category === 'string' ? a2.category : '' })
      }
    }
  } else if (typeof assignments === 'object') {
    for (const [p, c] of Object.entries(assignments as Record<string, unknown>)) {
      items.push({ path: p, category: String(c) })
    }
  }
  for (const { path: p, category: c } of items) {
    const clean = p.replace(/\\/g, '/').trim()
    const cat = c.trim()
    if (clean && (CATEGORIES as readonly string[]).includes(cat)) out.set(clean, cat)
  }
  return out
}

async function moveUnit(root: string, u: DocEntry, category: string): Promise<DocEntry | null> {
  const src = path.join(root, u.path.replace(/\//g, path.sep))
  const destDir = path.join(docsRootOf(root), category)
  const slug = slugOf(u.path)
  let dest = path.join(destDir, `${slug}.md`)
  let n = 2
  for (;;) {
    try {
      await fs.access(dest)
      dest = path.join(destDir, `${slug}-${n}.md`)
      n += 1
    } catch {
      break
    }
  }
  if (!await moveFile(src, dest)) return null
  const m: DocEntry = {
    path: safeRelative(dest, root), original_path: u.path, title: u.title,
    explicit_tags: [], zh: null, i18n: null, schema: null,
  }
  for (const [suf, key] of [['.zh.md', 'zh'], ['.i18n.yaml', 'i18n'], ['.schema.json', 'schema']] as const) {
    const v = u[key]
    if (v) {
      const csrc = path.join(root, v.replace(/\//g, path.sep))
      try {
        await fs.access(csrc)
        const cdest = dest.slice(0, -3) + suf
        if (await moveFile(csrc, cdest)) m[key] = safeRelative(cdest, root)
      } catch {}
    }
  }
  return m
}

async function updateReadme(root: string, index?: Record<string, unknown>): Promise<void> {
  index = index ?? await buildIndex(root)
  const docRoot = docsRootOf(root)
  const lines: string[] = ['# 项目文档索引', `最后更新：${nowStamp()}`, '']
  for (const cat of CATEGORIES) {
    const desc: Record<string, string> = {
      '1-决策记录': 'ADR 架构决策记录',
      '2-架构设计': '系统架构、模块设计',
      '3-API规范': 'RESTful API 设计规范',
      '4-编码规范': '各语言编码规范',
      '5-数据库设计': '表结构、ER 图',
      '6-UI/组件设计': 'UI 控件、组件设计规范',
      '7-调用规范': '服务间调用、异常处理、日志规范',
      '8-部署运维': '部署架构、环境配置',
      '9-系统要求': '功能需求、非功能需求',
    }
    lines.push(`## ${cat}`, '', `*${desc[cat]}*`, '')
    const d = path.join(docRoot, cat)
    let files: string[] = []
    try {
      files = (await fs.readdir(d)).filter(f => f.endsWith('.md') && f !== 'README.md').sort()
    } catch {}
    if (files.length) {
      for (const f of files) lines.push(`- [${await docTitle(path.join(d, f))}](${cat}/${f})`)
    } else {
      lines.push('（暂无文档）')
    }
    lines.push('')
  }

  const docs = docsOf(index)
  const archived = docs.filter(d => d.original_path)
  if (archived.length) {
    lines.push('## 归档文档（原位置 → 现位置）', '')
    for (const d of archived.sort((a, b) => (a.original_path ?? '').localeCompare(b.original_path ?? ''))) {
      lines.push(`- [${d.title}](${relLink(root, d.path)})  ← \`${d.original_path}\``)
    }
    lines.push('')
  }

  const ext = docs.filter(d => d.external)
  if (ext.length) {
    lines.push('## 外部文档（paths[] 登记，就地未归档）', '')
    for (const d of ext.sort((a, b) => a.path.localeCompare(b.path))) {
      const tagstr = d.tags?.length ? `  \`${d.tags.join('` `')}\`` : ''
      const idstr = d.id ? `\`${d.id}\` ` : ''
      lines.push(`- ${idstr}[${d.title}](${relLink(root, d.path)})${tagstr}`)
    }
    lines.push('')
  }

  const tagMap = (index.tags ?? {}) as Record<string, string[]>
  const tagKeys = Object.keys(tagMap)
  if (tagKeys.length) {
    lines.push('## 标签索引', '')
    for (const t of tagKeys.sort((a, b) => ((tagMap[b]?.length ?? 0) - (tagMap[a]?.length ?? 0)) || a.localeCompare(b))) {
      const list = tagMap[t] ?? []
      const links = list.map(p => `[${path.basename(p, '.md')}](${relLink(root, p)})`).join(', ')
      lines.push(`- **${t}** (${list.length}): ${links}`)
    }
    lines.push('')
  }
  await writeText(path.join(docRoot, 'README.md'), lines.join('\n'))
}

function relLink(root: string, p: string): string {
  try {
    return path.relative(docsRootOf(root), path.join(root, p.replace(/\//g, path.sep))).replace(/\\/g, '/')
  } catch {
    return p
  }
}

async function runIndexDocs(
  root: string,
  dryRun: boolean,
  roots?: string[],
  includeRoot: boolean = true,
  paths?: string[],
): Promise<string> {
  const existing = externalPaths(await readIndex(root))
  const reg = existing.map(p => ({ ...p }))
  const existingSet = new Set(reg.map(p => p.path))
  const proj = path.resolve(root)
  const added: string[] = []
  for (const p of asList(paths)) {
    const key = p.replace(/\\/g, '/').trim().replace(/^\/+/, '')
    if (!key || existingSet.has(key)) continue
    const fp = path.resolve(root, key.replace(/\//g, path.sep))
    if (fp === proj || fp.startsWith(proj + path.sep)) {
      try {
        await fs.access(fp)
        reg.push({ id: slugOf(key), path: key })
        existingSet.add(key)
        added.push(key)
      } catch {}
    }
  }
  const old = new Set(docsOf(await readIndex(root)).map(d => d.path))
  const index = await buildIndex(root, roots, includeRoot, reg)
  const newDocs = docsOf(index).filter(d => !old.has(d.path)).map(d => d.path)
  const lines: string[] = [
    `🗂️ 索引${dryRun ? '预览' : '完成'}：共 ${docsOf(index).length} 个文档，`
    + `${externalPaths(index).length} 个外部路径，${Object.keys(index.tags ?? {}).length} 个标签`,
  ]
  if (added.length) {
    lines.push(`新登记外部路径 ${added.length} 个：`)
    lines.push(...added.map(p => `  + ${p}`))
  }
  if (newDocs.length) {
    lines.push(`新增登记 ${newDocs.length} 个：`)
    lines.push(...newDocs.slice(0, 25).map(p => `  + ${p}`))
    if (newDocs.length > 25) lines.push(`  ... 共 ${newDocs.length} 个`)
  }
  if (!dryRun) {
    await saveIndex(root, index)
    lines.push(`已写入 \`${safeRelative(indexFileOf(root), docsRootOf(root))}\` 并刷新 README.md`)
  }
  return lines.join('\n')
}

async function runTagDocs(
  root: string,
  paths?: string[],
  ids?: string[],
  tags?: string[],
  mode: string = 'add',
): Promise<string> {
  const index = await buildIndex(root)
  const byPath = new Map(docsOf(index).map(d => [d.path, d]))
  const byId = new Map(docsOf(index).filter(d => d.id).map(d => [d.id, d]))
  const plist = (paths ?? []).map(p => p.replace(/\\/g, '/').trim())
  const ilist = (ids ?? []).map(s => typeof s === 'string' ? s.trim() : '').filter(Boolean)
  const tlist = normList(tags)
  if ((!plist.length && !ilist.length) || !tlist.length) {
    return '❌ 需要 tags，以及 paths 或 ids 至少一个'
  }
  const targets: DocEntry[] = []
  for (const p of plist) {
    const d = byPath.get(p) ?? byPath.get(`docs/${p}`)
    if (d) targets.push(d)
  }
  for (const i of ilist) {
    const d = byId.get(i)
    if (d) targets.push(d)
  }
  const changed: string[] = []
  for (const d of targets) {
    let ex = new Set(normList(d.explicit_tags))
    if (mode === 'remove') for (const t of tlist) ex.delete(t)
    else if (mode === 'set') ex = new Set(tlist)
    else for (const t of tlist) ex.add(t)
    d.explicit_tags = [...ex].sort()
    changed.push(d.id ?? d.path)
  }
  docsOf(index).sort((a, b) => a.path.localeCompare(b.path))
  recomputeTags(index)
  await saveIndex(root, index)
  const verb = { add: '追加', remove: '移除', set: '设置' }[mode] ?? '更新'
  return `✅ 已${verb}标签 ${tlist.join(', ')} → ${changed.length} 个文档：\n${changed.map(c => `  ${c}`).join('\n')}`
}

async function runListTags(root: string, tagName?: string): Promise<string> {
  const index = await readIndex(root)
  const tagMap = (index.tags ?? {}) as Record<string, string[]>
  if (tagName) {
    const t = tagName.trim().toLowerCase()
    const docs = tagMap[t]
    if (!docs) return `📭 无标签 \`${t}\``
    return trunc(`🏷️ 标签 \`${t}\`（${docs.length}）:\n${docs.map(p => `  ${p}`).join('\n')}`, 2500)
  }
  const keys = Object.keys(tagMap)
  if (!keys.length) return '📭 暂无标签'
  const lines = [`🏷️ 共 ${keys.length} 个标签：`, '']
  for (const t of keys.sort((a, b) => ((tagMap[b]?.length ?? 0) - (tagMap[a]?.length ?? 0)) || a.localeCompare(b))) {
    lines.push(`  ${t.padEnd(24)} ${tagMap[t]?.length ?? 0}`)
  }
  return trunc(lines.join('\n'), 2500)
}

async function runOrganize(
  root: string,
  dryRun: boolean,
  assignments?: unknown,
  roots?: string[],
  includeRoot: boolean = true,
): Promise<string> {
  const assigned = parseAssignments(assignments)
  const units = (await scanUnits(root, roots, includeRoot))
    .filter(u => !u.path.startsWith('docs/junsi-dev-docs/') && !u.external)
  if (!units.length) return '✅ 没有待归档的散落文档。'

  if (dryRun) {
    const lines: string[] = [`📂 待归档 ${units.length} 个文档（dry_run，未移动）：`, '']
    for (const u of units) {
      const cat = assigned.get(u.path) ?? suggestCategory(u.path, u.title ?? '', await readText(path.join(root, u.path)))
      const reason = assigned.has(u.path) ? '显式指定' : (cat ? '启发式建议' : '未能分类')
      lines.push(`  ${cat ? '→' : '✗'} ${u.path}`)
      lines.push(`      分类: ${cat ?? '需手动指定'} (${reason})`)
      if (cat) lines.push(`      目标: docs/junsi-dev-docs/${cat}/${slugOf(u.path)}.md`)
    }
    lines.push('', '💡 确认后传 assignments=[{path,category}] 且 dry_run=false 执行移动。')
    return trunc(lines.join('\n'), 4500)
  }

  const moved: DocEntry[] = []
  for (const u of units) {
    const cat = assigned.get(u.path)
    if (!cat) continue
    const m = await moveUnit(root, u, cat)
    if (m) moved.push(m)
  }
  if (!moved.length) return '⚠️ 未提供显式分类，未移动任何文件。请在 assignments 中指定 path→category。'

  const index = await buildIndex(root, roots, includeRoot)
  const byPath = new Map(docsOf(index).map(d => [d.path, d]))
  for (const m of moved) {
    const d = byPath.get(m.path)
    if (d) d.original_path = m.original_path
  }
  recomputeTags(index)
  await saveIndex(root, index)
  const lines = [`✅ 已归档 ${moved.length} 个文档（原位置已转为标签）：`, '']
  for (const m of moved) lines.push(`  ${m.original_path}\n    → ${m.path}`)
  return trunc(lines.join('\n'), 4500)
}

async function runRevert(root: string, dryRun: boolean, paths?: unknown): Promise<string> {
  const index = await readIndex(root)
  let targets = docsOf(index).filter(d => d.original_path)
  let plist: string[] = []
  if (Array.isArray(paths)) {
    plist = paths.map(p => String(p).replace(/\\/g, '/').trim()).filter(Boolean)
  } else if (typeof paths === 'string') {
    plist = paths.split(/[,\n]+/).map(s => s.trim().replace(/\\/g, '/')).filter(Boolean)
  }
  if (plist.length) {
    targets = targets.filter(d => plist.includes(d.path) || plist.includes(d.original_path ?? ''))
  }
  if (!targets.length) return '📭 没有可回滚的归档文档'
  if (dryRun) {
    const lines = [`⏪ 可回滚 ${targets.length} 个文档（dry_run，未移动）：`, '']
    for (const d of targets) lines.push(`  ${d.path}\n    → ${d.original_path}`)
    return trunc(lines.join('\n'), 4500)
  }
  const done: string[] = []
  for (const d of targets) {
    const src = path.join(root, d.path.replace(/\//g, path.sep))
    const dst = path.join(root, (d.original_path ?? '').replace(/\//g, path.sep))
    try {
      await fs.access(src)
    } catch {
      continue
    }
    const base = (d.original_path ?? '').endsWith('.md') ? (d.original_path ?? '').slice(0, -3) : (d.original_path ?? '')
    if (await moveFile(src, dst)) {
      for (const [suf, key] of [['.zh.md', 'zh'], ['.i18n.yaml', 'i18n'], ['.schema.json', 'schema']] as const) {
        const v = d[key]
        if (v) {
          try {
            await fs.access(path.join(root, v.replace(/\//g, path.sep)))
            await moveFile(path.join(root, v.replace(/\//g, path.sep)), path.join(root, (base + suf).replace(/\//g, path.sep)))
          } catch {}
        }
      }
      done.push(d.original_path ?? '')
    }
  }
  await saveIndex(root, await buildIndex(root))
  return `✅ 已回滚 ${done.length} 个文档：\n${done.map(p => `  ${p}`).join('\n')}`
}

async function createAdrFile(
  root: string,
  title: string,
  background: string,
  decision: string,
  alternatives?: Array<{ name?: string; pros?: string; cons?: string; reason?: string }>,
  impacts?: string[],
): Promise<string> {
  const adrDir = path.join(docsRootOf(root), '1-决策记录')
  await fs.mkdir(adrDir, { recursive: true })
  let maxN = 0
  try {
    for (const f of await fs.readdir(adrDir)) {
      const m = f.match(/ADR-(\d+)/)
      if (m) maxN = Math.max(maxN, parseInt(m[1] ?? '0', 10))
    }
  } catch {}
  const n = maxN + 1
  const safe = title.replace(/[^\w-]/g, '-')
  const fp = path.join(adrDir, `ADR-${String(n).padStart(3, '0')}-${safe}.md`)

  const lines = [
    `# ADR-${String(n).padStart(3, '0')}：${title}`,
    '',
    '| 属性 | 内容 |',
    '|---|---|',
    '| 状态 | 已采纳 |',
    `| 日期 | ${nowDate()} |`,
    '| 决策者 | AI Agent |',
    '',
    '## 背景',
    '',
    background,
    '',
    '## 决策',
    '',
    decision,
    '',
    '## 备选方案',
  ]
  if (alternatives && alternatives.length) {
    for (const a of alternatives) {
      lines.push('', `### 方案 ${a.name ?? '未命名'}`,
        `- 优点：${a.pros ?? '未说明'}`,
        `- 缺点：${a.cons ?? '未说明'}`,
        `- 为何不选：${a.reason ?? '未说明'}`)
    }
  } else {
    lines.push('', '（未记录备选方案）')
  }
  if (impacts && impacts.length) {
    lines.push('', '## 影响', ...impacts.map(i => `- ${i}`))
  }
  lines.push('', '## 修订记录',
    '| 日期 | 版本 | 修改内容 | 修改人 |',
    '|---|---|---|---|',
    `| ${nowDate()} | v1.0 | 初版创建 | AI Agent |`)

  if (await writeText(fp, lines.join('\n'))) {
    await updateReadme(root)
    return `✅ ADR 已创建：\`${safeRelative(fp, docsRootOf(root))}\``
  }
  return '❌ 创建失败'
}

// ── 代码感知 helper ──────────────────────────────────────────────────

function scanDirOf(root: string, defaultRel: string, pathArg?: string): string {
  if (typeof pathArg === 'string' && pathArg.trim()) return path.join(root, pathArg.trim())
  return path.join(root, defaultRel)
}

async function safeListdir(root: string, maxDepth: number = 2): Promise<string[]> {
  const out: string[] = []
  const rootResolved = path.resolve(root)
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const rel = path.relative(rootResolved, dir).replace(/\\/g, '/')
    const indent = '  '.repeat(depth)
    out.push(rel === '.' ? `${path.basename(rootResolved)}/` : `${indent}${path.basename(dir)}/`)
    const files = entries.filter(e => !e.isDirectory() && !e.isSymbolicLink()).map(e => e.name).sort()
    for (const fn of files.slice(0, 10)) out.push(`${indent}  ${fn}`)
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name)) {
        await walk(path.join(dir, e.name), depth + 1)
      }
    }
  }
  await walk(root, 0)
  return out.slice(0, 80)
}

async function extractEndpoints(root: string, pathArg?: string): Promise<Endpoint[]> {
  const base = scanDirOf(root, 'src-backend', pathArg)
  const endpoints: Endpoint[] = []
  const patterns: Array<{ re: RegExp; kind: string; hasRoute: boolean }> = [
    { re: /(?:app|group)\.Map(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)\("([^"]+)"/gi, kind: 'minimal', hasRoute: true },
    { re: /\[Http(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)\("?([^")\]]*)"?\)?\]/gi, kind: 'controller', hasRoute: true },
    { re: /@(Get|Post|Put|Delete|Patch)Mapping\("([^"]*)"\)/gi, kind: 'spring-boot', hasRoute: true },
    { re: /@RequestMapping\(value\s*=\s*"([^"]+)"/gi, kind: 'spring-boot', hasRoute: true },
    { re: /@RequestMapping\("([^"]+)"/gi, kind: 'spring-boot', hasRoute: true },
  ]
  const exts = ['.cs', '.java', '.kt']
  for (const fp of await walkFiles(base, exts)) {
    const content = await readText(fp)
    if (!content) continue
    for (const { re, kind } of patterns) {
      for (const m of content.matchAll(re)) {
        const method = m[1] ?? ''
        const route = m[2] ?? '/'
        endpoints.push({ method, route, file: safeRelative(fp, root), kind })
      }
    }
  }
  const seen = new Set<string>()
  return endpoints.filter((e) => {
    const key = `${e.method}|${e.route}|${e.file}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function extractFrontendRoutes(root: string, pathArg?: string): Promise<Route[]> {
  const base = scanDirOf(root, 'src', pathArg)
  const routes: Route[] = []
  for (const fp of await walkFiles(base, ['.tsx', '.ts'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/<Route\s+path="([^"]*)"\s*element=\{?<(\w+)/g)) {
      routes.push({ path: m[1] ?? '', component: m[2] ?? '', file: safeRelative(fp, root) })
    }
    for (const m of content.matchAll(/path:\s*["']([^"']+)["'],?\s*element/g)) {
      routes.push({ path: m[1] ?? '', file: safeRelative(fp, root) })
    }
    for (const m of content.matchAll(/path:\s*["']([^"']+)["'],?\s*lazy/g)) {
      routes.push({ path: m[1] ?? '', file: safeRelative(fp, root) })
    }
  }
  return routes
}

async function extractComponents(root: string, pathArg?: string): Promise<ComponentEntry[]> {
  const base = scanDirOf(root, 'src', pathArg)
  const comps: ComponentEntry[] = []
  for (const fp of await walkFiles(base, ['.tsx'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/export\s+(?:default\s+)?function\s+(\w+)/g)) {
      comps.push({ name: m[1] ?? '', file: safeRelative(fp, root), type: 'function' })
    }
    for (const m of content.matchAll(/export\s+const\s+(\w+)\s*[:=]/g)) {
      comps.push({ name: m[1] ?? '', file: safeRelative(fp, root), type: 'const' })
    }
    for (const m of content.matchAll(/interface\s+(\w+Props?\w*)\s*{/g)) {
      comps.push({ name: m[1] ?? '', file: safeRelative(fp, root), type: 'interface' })
    }
  }
  return comps
}

interface DepsSummary {
  project_name?: string
  version?: string
  scripts?: Record<string, string>
  frontend?: Record<string, string>
  backend?: { framework?: string; packages?: string[]; project_refs?: string[] }
  tauri?: Record<string, string>
}

async function extractDeps(root: string, pathArg?: string): Promise<DepsSummary> {
  const result: DepsSummary & Record<string, unknown> = { project_name: '', version: '', scripts: {}, frontend: {}, backend: {}, tauri: {} }
  const pkg = path.join(root, 'package.json')
  try {
    const d = JSON.parse(await readText(pkg)) as Record<string, unknown>
    result.project_name = typeof d.name === 'string' ? d.name : ''
    result.version = typeof d.version === 'string' ? d.version : ''
    result.scripts = typeof d.scripts === 'object' && d.scripts !== null ? d.scripts as Record<string, string> : {}
    const deps = { ...(d.dependencies ?? {}), ...(d.devDependencies ?? {}) }
    const sorted = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
    result.frontend = Object.fromEntries(sorted.slice(0, 20).map(([k, v]) => [k, typeof v === 'string' ? v : '']))
  } catch {}

  const backendDir = scanDirOf(root, 'src-backend', pathArg)
  for (const csproj of await walkFiles(backendDir, ['.csproj'])) {
    const content = await readText(csproj)
    if (!content) continue
    const tf = content.match(/<TargetFramework>(.*?)</)
    const backend = (result.backend ??= {})
    if (tf) backend.framework = tf[1] ?? ''
    const refs = [...content.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map(m => m[1] ?? '')
    if (refs.length) backend.packages = refs.slice(0, 15)
    const projRefs = [...content.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)].map(m => safeRelative(m[1] ?? '', root))
    if (projRefs.length) backend.project_refs = projRefs
  }

  const cargo = path.join(root, 'src-tauri', 'Cargo.toml')
  try {
    const content = await readText(cargo)
    const deps = [...content.matchAll(/^(\w[\w-]+)\s*=\s*{?\s*version\s*=\s*"([^"]+)"/gm)]
    if (deps.length) result.tauri = Object.fromEntries(deps.slice(0, 15).map(m => [m[1] ?? '', m[2] ?? '']))
  } catch {}

  return result
}

async function extractTauriCommands(root: string, pathArg?: string): Promise<NamedFile[]> {
  const base = scanDirOf(root, 'src-tauri/src', pathArg)
  const cmds: NamedFile[] = []
  for (const fp of await walkFiles(base, ['.rs'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/#\[tauri::command\]\s*\n\s*(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)/g)) {
      cmds.push({ name: m[1] ?? '', file: safeRelative(fp, root) })
    }
  }
  return cmds
}

async function extractTauriCapabilities(root: string, pathArg?: string): Promise<Array<Record<string, unknown>>> {
  const base = scanDirOf(root, 'src-tauri/capabilities', pathArg)
  const caps: Array<Record<string, unknown>> = []
  for (const fp of await walkFiles(base, ['.json'])) {
    const content = await readText(fp)
    if (!content) continue
    try {
      const d = JSON.parse(content) as Record<string, unknown>
      caps.push({
        file: safeRelative(fp, root),
        identifier: d.identifier ?? '',
        windows: d.windows ?? [],
        permissions: Array.isArray(d.permissions) ? (d.permissions as unknown[]).slice(0, 20) : [],
      })
    } catch {
      caps.push({ file: safeRelative(fp, root), error: 'JSON parse failed' })
    }
  }
  return caps
}

async function extractApiClient(root: string, pathArg?: string): Promise<ApiCall[]> {
  const base = scanDirOf(root, 'src/api', pathArg)
  const calls: ApiCall[] = []
  for (const fp of await walkFiles(base, ['.ts', '.tsx'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/(get|post|put|delete|patch|request)\s*\(\s*['"]([^'"]+)['"]/gi)) {
      calls.push({ call: (m[1] ?? '').toLowerCase(), url: m[2] ?? '', file: safeRelative(fp, root) })
    }
  }
  return calls
}

async function extractStores(root: string, pathArg?: string): Promise<NamedFile[]> {
  const base = scanDirOf(root, 'src/stores', pathArg)
  const stores: NamedFile[] = []
  for (const fp of await walkFiles(base, ['.ts', '.tsx'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/(?:export\s+)?(?:const|function)\s+(\w+(?:Store|State)?)\s*[=:]/g)) {
      stores.push({ name: m[1] ?? '', file: safeRelative(fp, root) })
    }
  }
  return stores
}

async function extractHooks(root: string, pathArg?: string): Promise<NamedFile[]> {
  const base = scanDirOf(root, 'src/hooks', pathArg)
  const hooks: NamedFile[] = []
  for (const fp of await walkFiles(base, ['.ts', '.tsx'])) {
    const content = await readText(fp)
    if (!content) continue
    for (const m of content.matchAll(/(?:export\s+)?(?:const|function)\s+(use\w+)/g)) {
      hooks.push({ name: m[1] ?? '', file: safeRelative(fp, root) })
    }
  }
  return hooks
}

interface CodeContextInfo {
  file?: string
  language?: string
  layer?: string
  size?: string
  error?: string
  definitions?: string[]
  exports?: string[]
  imports?: string[]
  tauri_commands?: string[]
  endpoints?: string[]
}

async function extractCodeContext(root: string, relPath: string): Promise<CodeContextInfo> {
  const fp = path.join(root, relPath.replace(/\//g, path.sep))
  try {
    await fs.access(fp)
  } catch {
    return { error: `文件不存在: ${relPath}` }
  }
  const st = await fs.stat(fp)
  if (!st.isFile()) return { error: `文件不存在: ${relPath}` }
  const content = await readText(fp)
  if (!content) return { error: '文件为空或无法读取' }
  const lines = content.split('\n').length
  const info: CodeContextInfo = {
    file: tag(relPath),
    language: fileLang(relPath) || '未知',
    layer: fileLayer(relPath) || '未知',
    size: `${lines} 行`,
  }
  const ext = path.extname(fp).toLowerCase()
  if (ext === '.rs') {
    info.definitions = [...content.matchAll(/(?:pub\s+)?(?:fn|struct|enum|trait|impl|mod|const|static|type)\s+(\w[\w<>]*)/g)].map(m => m[1] ?? '').slice(0, 15)
    info.tauri_commands = [...content.matchAll(/#\[tauri::command\]\s*\n\s*(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)/g)].map(m => m[1] ?? '')
  } else if (ext === '.cs') {
    info.definitions = [...content.matchAll(/(?:public|private|internal|protected)?\s*(?:static\s+)?(?:class|interface|record|struct|enum|void|Task|IActionResult|string|int|bool|long|Guid)\s+(\w[\w<>]*)/g)].map(m => m[1] ?? '').slice(0, 15)
    info.endpoints = [...content.matchAll(/(?:app|group)\.Map(GET|POST|PUT|DELETE|PATCH)\(/gi)].map(m => m[1] ?? '')
  } else if (ext === '.ts' || ext === '.tsx') {
    info.exports = [...content.matchAll(/export\s+(?:default\s+)?(?:function|const|class|type|interface)\s+(\w+)/g)].map(m => m[1] ?? '').slice(0, 15)
    info.imports = [...content.matchAll(/import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"]([^'"]+)['"]/g)].map(m => m[1] ?? '').slice(0, 10)
  } else if (ext === '.py') {
    info.definitions = [...content.matchAll(/(?:async\s+)?def\s+(\w+)|class\s+(\w+)/g)].map(m => (m[1] ?? m[2] ?? '')).slice(0, 15)
  }
  return info
}

// ── 工具注册 ─────────────────────────────────────────────────────────

export function apply(ctx: Context): void {
  const register = <A extends object>(spec: {
    name: string
    description: string
    parameters: { [K in keyof A]?: unknown }
    execute: (args: A, exec: ToolRunContext) => Promise<string>
  }): void => {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters as never,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        return spec.execute(args as A, exec)
      },
    }))
  }

  register<{ keywords?: string; category?: string; tags?: string[] }>({
    name: 'query_docs',
    description: '查询项目文档。搜索 docs/ 下所有文档（含已归档文档），并续扫 docs-index.json 的 paths[] 登记的外部文档（无法归档、就地接入），返回路径/id、标签和摘要。keywords 与 tags 至少给一个。',
    parameters: {
      keywords: { type: 'string', description: '搜索关键词（AND 匹配），逗号分隔，可选' },
      category: { type: 'string', enum: [...CATEGORIES], description: '限定 toolkit 分类（仅对 junsi-dev-docs 内生效，可选）' },
      tags: { type: 'array', items: { type: 'string' }, description: '按标签过滤（AND，需全部命中），可选' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const r = await searchDocs(root, args.keywords ?? '', args.category, args.tags)
      return r.length ? JSON.stringify(r, null, 2) : '📭 未找到匹配文档'
    },
  })

  register<{
    title: string
    background: string
    decision: string
    alternatives?: Array<{ name?: string; pros?: string; cons?: string; reason?: string }>
    impacts?: string[]
  }>({
    name: 'create_adr',
    description: '创建新的架构决策记录（ADR）。自动编号。',
    parameters: {
      title: { type: 'string', required: true, description: 'ADR 标题' },
      background: { type: 'string', required: true, description: '背景与现状' },
      decision: { type: 'string', required: true, description: '决策内容' },
      alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, pros: { type: 'string' }, cons: { type: 'string' }, reason: { type: 'string' } } }, description: '备选方案' },
      impacts: { type: 'array', items: { type: 'string' }, description: '影响范围' },
    },
    async execute(args, exec) {
      return createAdrFile(projectRootOf(exec), args.title, args.background, args.decision, args.alternatives, args.impacts)
    },
  })

  register<{ doc_path: string; content: string; change_description: string }>({
    name: 'update_doc',
    description: '更新现有文档。追加内容并记录修订历史。',
    parameters: {
      doc_path: { type: 'string', required: true, description: "文档相对路径，如 '3-API规范/RESTful-规范.md'" },
      content: { type: 'string', required: true, description: '要写入的内容' },
      change_description: { type: 'string', required: true, description: '变更说明' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const docRoot = docsRootOf(root)
      const dp = path.join(docRoot, args.doc_path)
      try {
        await fs.access(dp)
      } catch {
        const ok = await writeText(dp, args.content)
        return ok ? `✅ 已创建：\`${safeRelative(dp, docRoot)}\`\n变更：${args.change_description}` : '❌ 创建失败'
      }
      const existing = await readText(dp)
      const next = `${existing}\n\n### ${nowDate()} 更新\n${args.content}\n`
      const ok2 = await writeText(dp, next)
      return ok2 ? `✅ 已更新：\`${safeRelative(dp, docRoot)}\`\n变更：${args.change_description}` : '❌ 更新失败'
    },
  })

  register<{ dry_run?: boolean; roots?: string[]; include_root?: boolean; paths?: string[] }>({
    name: 'index_docs',
    description: '扫描并登记 docs/（含项目根）与 paths[] 外部路径到 docs/junsi-dev-docs/docs-index.json，不移动文件。可传 paths 登记新外部路径（无法归档、就地接入的文档）。i18n 三件套(.md/.zh.md/.i18n.yaml)合并为一个文档单元，外部文档分配 id。',
    parameters: {
      dry_run: { type: 'boolean', description: '仅预览不写入，默认 false', default: false },
      roots: { type: 'array', items: { type: 'string' }, description: '额外扫描目录' },
      include_root: { type: 'boolean', description: '是否扫描项目根 *.md，默认 true', default: true },
      paths: { type: 'array', items: { type: 'string' }, description: '额外登记的外部文档路径（文件或目录），可选' },
    },
    async execute(args, exec) {
      return runIndexDocs(projectRootOf(exec), args.dry_run ?? false, args.roots, args.include_root ?? true, args.paths)
    },
  })

  register<{ dry_run?: boolean; assignments?: Array<{ path: string; category: string }>; roots?: string[]; include_root?: boolean }>({
    name: 'organize_docs',
    description: '整理归档：扫描散落文档（docs/**、项目根 *.md、roots 指定目录）并移动到 docs/junsi-dev-docs/ 的 9 大分类。默认 dry_run=true 仅预览；需传 assignments 显式指定 path→分类并 dry_run=false 才真正移动。原位置写入索引并转为标签，可用 revert_docs 回滚。paths[] 已登记的外部文档（无法归档）不会被移动。',
    parameters: {
      dry_run: { type: 'boolean', description: '仅预览不移动，默认 true', default: true },
      assignments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, category: { type: 'string', enum: [...CATEGORIES] } } }, description: '显式分类：[{path, category}]，path 相对项目根' },
      roots: { type: 'array', items: { type: 'string' }, description: '额外扫描目录（项目相对路径），可选' },
      include_root: { type: 'boolean', description: '是否扫描项目根 *.md，默认 true', default: true },
    },
    async execute(args, exec) {
      return runOrganize(projectRootOf(exec), args.dry_run ?? true, args.assignments, args.roots, args.include_root ?? true)
    },
  })

  register<{ dry_run?: boolean; paths?: string[] }>({
    name: 'revert_docs',
    description: '将已归档文档按索引中的 original_path 回滚到原位置。默认 dry_run=true。',
    parameters: {
      dry_run: { type: 'boolean', description: '仅预览不移动，默认 true', default: true },
      paths: { type: 'array', items: { type: 'string' }, description: '仅回滚指定文档（归档路径或原路径），可选' },
    },
    async execute(args, exec) {
      return runRevert(projectRootOf(exec), args.dry_run ?? true, args.paths)
    },
  })

  register<{ paths?: string[]; tags: string[]; mode?: string; ids?: string[] }>({
    name: 'tag_docs',
    description: '给文档追加/移除/设置显式标签（写入索引，不改动文档文件）。junsi-dev-docs 内文档用 paths；paths[] 外部文档用 ids。',
    parameters: {
      paths: { type: 'array', items: { type: 'string' }, description: '文档路径，可选' },
      ids: { type: 'array', items: { type: 'string' }, description: '外部文档 id，可选' },
      tags: { type: 'array', items: { type: 'string' }, required: true, description: '标签' },
      mode: { type: 'string', enum: ['add', 'remove', 'set'], default: 'add', description: '追加/移除/设置，默认 add' },
    },
    async execute(args, exec) {
      return runTagDocs(projectRootOf(exec), args.paths, args.ids, args.tags, args.mode ?? 'add')
    },
  })

  register<{ tag?: string }>({
    name: 'list_tags',
    description: '列出索引中的所有标签及文档数；给 tag 参数则列出该标签下的文档。',
    parameters: {
      tag: { type: 'string', description: '查看单个标签的文档列表（可选）' },
    },
    async execute(args, exec) {
      return runListTags(projectRootOf(exec), args.tag)
    },
  })

  register<{ doc_type: string; content: string; target_path?: string; append_to_existing?: boolean }>({
    name: 'generate_docs',
    description: '生成项目文档。支持任意类型的专题文档。',
    parameters: {
      doc_type: { type: 'string', required: true, description: "文档类型，如 '启动流程'、'联机流程'" },
      content: { type: 'string', required: true, description: 'AI 分析好的文档内容（Markdown）' },
      target_path: { type: 'string', description: "保存路径，如 '2-架构设计/启动流程.md'，不填自动生成" },
      append_to_existing: { type: 'boolean', description: '追加到已有文档', default: false },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const docRoot = docsRootOf(root)
      let target = args.target_path
      if (!target) {
        const catMap: Record<string, string> = {
          启动: '2-架构设计', 流程: '2-架构设计', 架构: '2-架构设计',
          部署: '8-部署运维', API: '3-API规范', 接口: '3-API规范',
          数据库: '5-数据库设计', UI: '6-UI/组件设计', 组件: '6-UI/组件设计',
          调用: '7-调用规范', 需求: '9-系统要求',
        }
        const cat = Object.entries(catMap).find(([k]) => args.doc_type.includes(k))?.[1] ?? '2-架构设计'
        target = `${cat}/${args.doc_type.replace(/[/\\]/g, '-')}.md`
      }
      const fp = path.join(docRoot, target)
      const doc = [`# ${args.doc_type}`, `\n> 生成时间：${nowStamp()}\n`, args.content,
        '\n## 修订记录', '| 日期 | 版本 | 修改内容 | 修改人 |',
        `| ${nowDate()} | v1.0 | 初版创建 | AI Agent |`]
      let merged = doc.join('\n')
      const exists = await (async () => { try { await fs.access(fp); return true } catch { return false } })()
      if (args.append_to_existing && exists) {
        merged = `${await readText(fp)}\n\n${merged}`
      }
      const action = args.append_to_existing && exists ? '追加' : '创建'
      const ok = await writeText(fp, merged)
      return ok ? `✅ 文档已${action}\n路径：\`docs/junsi-dev-docs/${target}\`` : `❌ 生成失败：${target}`
    },
  })

  register<{ subpath?: string; depth?: number; path?: string }>({
    name: 'project_tree',
    description: '返回项目目录树（限制深度和条目数），快速了解项目结构。',
    parameters: {
      subpath: { type: 'string', description: "限定子目录，如 'src/pages'、'src-backend'（可选）" },
      depth: { type: 'integer', description: '扫描深度，默认 2，最大 4', default: 2 },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const sub = args.subpath ?? ''
      const depth = Math.min(args.depth ?? 2, 4)
      let base = root
      if (sub) {
        base = path.join(root, sub.replace(/\//g, path.sep))
        try {
          await fs.access(base)
        } catch {
          return `❌ 目录不存在：${sub}`
        }
      }
      const tree = await safeListdir(base, depth)
      return `📁 项目树：\`${safeRelative(base, root)}\` (depth=${depth})\n\n${tree.join('\n')}`
    },
  })

  register<{ path?: string }>({
    name: 'api_endpoints',
    description: '扫描后端代码文件，返回 API 端点列表。支持 C# Minimal API / Controller、Java Spring Boot、Kotlin（方法 + 路由 + 文件位置）。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src-backend）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const eps = await extractEndpoints(root, args.path)
      if (!eps.length) return '📭 未发现 API 端点'
      const lines = [`📡 共 ${eps.length} 个端点：`, '']
      for (const e of eps.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))) {
        lines.push(`  [${e.method.padStart(6)}]  ${e.route}  ← ${tag(e.file)}`)
      }
      return trunc(lines.join('\n'), 3000)
    },
  })

  register<{ path?: string }>({
    name: 'frontend_routes',
    description: '扫描前端 TSX 文件，返回路由定义列表（path + component + 文件位置）。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      let routes = await extractFrontendRoutes(root, args.path)
      if (!routes.length) {
        const appTsx = path.join(root, 'src', 'App.tsx')
        try {
          const content = await readText(appTsx)
          if (content) {
            const imports = [...content.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/pages\/(\w+)['"]/g)]
            routes = imports.map(m => ({ path: `/${(m[1] ?? '').toLowerCase()}`, component: m[1] ?? '', file: 'src/App.tsx' }))
          }
        } catch {}
      }
      if (!routes.length) return '📭 未发现前端路由'
      const lines = [`🧭 共 ${routes.length} 个路由：`, '']
      for (const r of routes.sort((a, b) => a.path.localeCompare(b.path))) {
        const comp = r.component ? r.component : ''
        lines.push(`  ${r.path.padEnd(30)} → ${comp ? comp + '  ' : ''}(${tag(r.file)})`)
      }
      return trunc(lines.join('\n'), 2000)
    },
  })

  register<{ dir?: string; path?: string }>({
    name: 'component_inventory',
    description: '扫描 React 组件，返回组件名、类型和文件位置。',
    parameters: {
      dir: { type: 'string', description: "限定目录，如 'components'、'pages'（可选）" },
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      let comps = await extractComponents(root, args.path)
      const dirFilter = args.dir ?? ''
      if (dirFilter) {
        comps = comps.filter(c => c.file.includes(`/${dirFilter}/`) || c.file.startsWith(`${dirFilter}/`) || c.file.includes(`src/${dirFilter}/`))
      }
      if (!comps.length) return '📭 未发现组件'
      const funcs = comps.filter(c => c.type === 'function')
      const ifaces = comps.filter(c => c.type === 'interface')
      const lines = [`🧩 共 ${comps.length} 个条目`, '']
      if (funcs.length) {
        lines.push(`📦 组件 (${funcs.length})：`)
        for (const c of funcs) lines.push(`  ${c.name.padEnd(30)} ${tag(c.file)}`)
      }
      if (ifaces.length) {
        lines.push(`📐 Props 接口 (${ifaces.length})：`)
        for (const c of ifaces) lines.push(`  ${c.name.padEnd(30)} ${tag(c.file)}`)
      }
      return trunc(lines.join('\n'), 3000)
    },
  })

  register<{ path?: string }>({
    name: 'project_config',
    description: '返回项目关键配置摘要（package.json 脚本、后端框架、Tauri 依赖等）。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const deps = await extractDeps(root, args.path)
      const lines = [`📋 项目配置：${deps.project_name ?? ''} v${deps.version ?? ''}`, '']
      const scripts = deps.scripts ?? {}
      const scriptKeys = Object.keys(scripts)
      if (scriptKeys.length) {
        lines.push('📜 脚本：')
        for (const k of scriptKeys.slice(0, 10)) lines.push(`  ${k.padEnd(20)} ${scripts[k] ?? ''}`)
      }
      const backend = deps.backend ?? {}
      if (backend.framework) {
        lines.push(`\n🔧 后端 (C#)：${backend.framework}`)
        if (backend.packages) lines.push(`  包: ${backend.packages.slice(0, 8).join(', ')}`)
      }
      const tauri = deps.tauri ?? {}
      const tauriKeys = Object.keys(tauri)
      if (tauriKeys.length) {
        lines.push('\n🦀 Tauri (Rust)：')
        for (const k of tauriKeys.slice(0, 8)) lines.push(`  ${k.padEnd(25)} ${tauri[k] ?? ''}`)
      }
      const frontend = deps.frontend ?? {}
      const feKeys = Object.keys(frontend)
      if (feKeys.length) {
        lines.push(`\n⚛️ 前端 (TS/TSX)：${feKeys.length} 个依赖`)
        for (const k of feKeys.slice(0, 12)) lines.push(`  ${k.padEnd(25)} ${frontend[k] ?? ''}`)
      }
      return trunc(lines.join('\n'), 3000)
    },
  })

  register<{ path?: string }>({
    name: 'tauri_commands',
    description: '扫描 Rust #[tauri::command] 函数列表（Tauri IPC 入口）。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src-tauri/src）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const cmds = await extractTauriCommands(root, args.path)
      if (!cmds.length) return '📭 未发现 Tauri command'
      const lines = [`🦀 共 ${cmds.length} 个 Tauri command：`, '']
      for (const c of cmds) lines.push(`  ${c.name.padEnd(30)} ${tag(c.file)}`)
      return trunc(lines.join('\n'), 2000)
    },
  })

  register<{ path?: string }>({
    name: 'tauri_capabilities',
    description: '解析 src-tauri/capabilities/ 权限 JSON 文件。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src-tauri/capabilities）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const caps = await extractTauriCapabilities(root, args.path)
      if (!caps.length) return '📭 未发现 capabilities 文件'
      const lines = [`🔐 共 ${caps.length} 个能力文件：`, '']
      for (const c of caps) {
        const perms = (c.permissions ?? []) as unknown[]
        lines.push(`  ${tag(String(c.file))}  (${perms.length} permissions)`)
        for (const p of perms.slice(0, 8)) lines.push(`    - ${String(p)}`)
        if (perms.length > 8) lines.push(`    ... (${perms.length} total)`)
      }
      return trunc(lines.join('\n'), 3000)
    },
  })

  register<{ path?: string }>({
    name: 'api_client',
    description: '扫描 src/api/ 前端请求后端的方法和 URL 列表。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src/api）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const calls = await extractApiClient(root, args.path)
      if (!calls.length) return '📭 未发现 API 调用'
      const lines = [`🌐 共 ${calls.length} 个 API 调用：`, '']
      for (const c of calls.sort((a, b) => a.file.localeCompare(b.file)).slice(0, 25)) {
        lines.push(`  ${c.call.padStart(8)}  ${c.url.padEnd(40)}  ${tag(c.file)}`)
      }
      if (calls.length > 25) lines.push(`  ... (${calls.length} total)`)
      return trunc(lines.join('\n'), 3000)
    },
  })

  register<{ path?: string }>({
    name: 'stores',
    description: '扫描 src/stores/ 状态管理定义。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src/stores）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const stores = await extractStores(root, args.path)
      if (!stores.length) return '📭 未发现状态管理'
      const lines = [`🗄️ 共 ${stores.length} 个 store/state：`, '']
      for (const s of stores) lines.push(`  ${s.name.padEnd(30)} ${tag(s.file)}`)
      return trunc(lines.join('\n'), 2000)
    },
  })

  register<{ path?: string }>({
    name: 'hooks',
    description: '扫描 src/hooks/ 自定义 React Hook 列表。',
    parameters: {
      path: { type: 'string', description: '自定义扫描目录（相对项目根，可选，默认 src/hooks）' },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const hooks = await extractHooks(root, args.path)
      if (!hooks.length) return '📭 未发现自定义 Hook'
      const lines = [`🪝 共 ${hooks.length} 个 Hook：`, '']
      for (const h of hooks) lines.push(`  ${h.name.padEnd(30)} ${tag(h.file)}`)
      return trunc(lines.join('\n'), 2000)
    },
  })

  register<{ path: string }>({
    name: 'code_context',
    description: '分析单个文件：语言、所属层、关键定义（函数/类/导出/导入）。迁移或修 bug 时用来确认文件身份。',
    parameters: {
      path: { type: 'string', required: true, description: "文件相对路径，如 'src-tauri/src/lib.rs'、'src-backend/.../Program.cs'" },
    },
    async execute(args, exec) {
      const root = projectRootOf(exec)
      const c = await extractCodeContext(root, args.path)
      if (c.error) return `❌ ${c.error}`
      const lines = [
        `📄 ${c.file ?? ''}`,
        `  语言: ${c.language ?? ''}  |  层: ${c.layer ?? ''}  |  ${c.size ?? ''}`,
      ]
      const labels: Record<string, string> = { definitions: '定义', exports: '导出', imports: '导入', tauri_commands: 'Tauri command', endpoints: '端点' }
      for (const key of ['definitions', 'exports', 'imports', 'tauri_commands', 'endpoints'] as const) {
        const vals = c[key]
        if (vals && vals.length) {
          const label = labels[key]
          const shown = vals.slice(0, 8)
          lines.push(`  ${label}: ${shown.join(', ')}${vals.length > 8 ? ' ...' : ''}`)
        }
      }
      return lines.join('\n')
    },
  })
}
