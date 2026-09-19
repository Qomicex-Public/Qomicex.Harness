// junsi-dev-toolkit git 工具插件 (DSH port)
//
// 通用 git 透传工具：把模型给的完整 `git <args>` 命令直接执行。
//
// 设计要点 —— 为什么这个工具能绕过沙箱对 git 凭据(PAT/ssh.exe)的隔离：
//   DSH 的 bash/pwsh 工具命令走受限 token 沙箱(dsh-sandbox-windows-acl /
//   bwrap)，沙箱子进程拿不到用户的 git credential helper / ssh agent /
//   ssh.exe，导致 GitHub HTTP/SSH 的 pull/push 认证失败。
//   本工具不用 bash-sandbox，而是用 Node child_process 在 HOST 进程的完整
//   用户身份下直接 spawn git，因此继承用户的凭据环境(~/.git-credentials,
//   ssh-agent, ~/.ssh 等)，GH HTTP/SSH 认证正常。
//
//   若模型需要显式呈现在更高权限下运行，可传 sandbox=danger-full-access，
//   工具仍以 host spawn 执行（本身就不受限），并在结果里注明。

import { spawn } from 'node:child_process'
import { TextDecoder } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable Loader identity. */
export const name = 'git'

/** Services used by the git passthrough tool. */
export const inject = ['tools']

interface GitRunOptions {
  cwd: string
  timeoutMs?: number
}

interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

// 解码缓冲区：优先 UTF-8，若出现替换符()则按 GBK/CP936 重解（Windows git 默认输出 GBK）
function decode(buf: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8')
  const s = utf8.decode(buf)
  if (!s.includes('\uFFFD')) return s
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return s
  }
}

function runGit(args: string[], opts: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const nv: NodeJS.ProcessEnv = { ...process.env }
    // 强交互关闭：否则 rebase --continue / commit / merge / credential prompt 会阻塞读 stdin / 起编辑器
    nv.GIT_EDITOR = 'true'
    nv.GIT_SEQUENCE_EDITOR = 'true'
    nv.GIT_MERGE_AUTOEDIT = 'no'
    nv.GIT_TERMINAL_PROMPT = '0'
    nv.GIT_PAGER = 'cat'
    // stdin 用 'ignore'：任何 git 读 stdin 立即得到 EOF，绝不阻塞挂起；stdout/stderr 用管道捕获
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: nv,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d: Buffer) => (stdout += decode(d)))
    child.stderr.on('data', (d: Buffer) => (stderr += decode(d)))
    const timeoutMs = opts.timeoutMs || 120000
    let timedOut = false
    const killTree = (): void => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
      // Windows：git 可能拉起 editor/ssh 子进程持有管道导致 close 不触发，强制结束进程树
      if (process.platform === 'win32' && child.pid) {
        try {
          const task = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          const guard = setTimeout(() => { try { task.kill('SIGKILL') } catch {} }, 3000)
          task.on('close', () => { clearTimeout(guard) })
        } catch {}
      }
    }
    const timeout = setTimeout(killTree, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ code: -1, stdout, stderr: stderr || err.message })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({
        code: code ?? (signal ? -2 : -3),
        stdout,
        stderr: timedOut ? stderr + `\n[timeout] 命令超过 ${timeoutMs}ms 已被终止（可能 git 在等输入/编辑器/网络）。` : stderr,
      })
    })
  })
}

/**
 * Register the git passthrough tool.
 * @param ctx - services.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'git',
    description:
      '通用 git 工具：在当前会话 workspace 下透传执行完整 git 命令（status/add/commit/push/pull/fetch/clone/branch/log/diff 等）。' +
      '以 HOST 完整身份直接运行 git（不经受限沙箱），因此能访问用户的 git 凭据(PAT/ssh agent/~/.ssh)和 ssh.exe，' +
      'GitHub HTTP/SSH 的 pull/push 认证可用。传 workdir 可指定执行目录；需要显式更高权限标注时传 sandbox=danger-full-access。',
    parameters: {
      args: {
        type: 'array', required: true,
        description: '完整 git 参数数组，如 ["status"] 或 ["push","origin","main"]；不要包含 "git" 本身',
        items: { type: 'string' },
      },
      workdir: { type: 'string', description: 'git 执行目录。默认当前会话 workspace cwd' },
      sandbox: {
        type: 'string',
        enum: ['default', 'danger-full-access'],
        description: 'default=直接以 host 身份执行；danger-full-access=显式标注以完整权限执行（访问凭据）。默认 default',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (!Array.isArray(args.args) || !args.args.length) return 'git: 需要非空 args 数组'
      const cwd: string = args.workdir || exec.agent?.session.header.cwd || process.cwd()
      const r = await runGit(args.args, { cwd })
      const note = args.sandbox === 'danger-full-access' ? '\n[sandbox] 以 danger-full-access（host 完整身份）执行，可访问 git 凭据。' : ''
      const out: string[] = [`工作目录: ${cwd}`, `命令: git ${args.args.join(' ')}`, '']
      if (r.stdout.trim()) out.push(r.stdout.trimEnd())
      if (r.stderr.trim()) out.push('[stderr]', r.stderr.trimEnd())
      out.push('')
      out.push(`exit code: ${r.code}`)
      if (r.code !== 0) out.push('（非零退出。若为认证错误，请确认 git credential helper/ssh-agent 已配置，并考虑传 sandbox=danger-full-access 以完整身份重试）')
      return out.join('\n') + note
    },
  }))
}
