/**
 * The benchmark CLI: run every scenario, print the report, and exit non-zero
 * when a hard constraint fails.
 *
 * The exit code is the contract. A benchmark whose failure is a printed line
 * is a benchmark that never blocks anything.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/main
 */

import { check, exitCodeFor, format } from './ci/hard-constraints.ts'
import { formatReport, runBenchmark } from './report.ts'

/**
 * Run the benchmark and report.
 * @returns The process exit code.
 */
export async function main(): Promise<number> {
  const report = await runBenchmark()
  process.stdout.write(`${formatReport(report)}\n`)
  const results = check(report.metrics)
  process.stdout.write(`\n${format(results)}\n`)
  return exitCodeFor(results)
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.exitCode = await main()
}
