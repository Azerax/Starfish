// Self-authored execution — closing the Q12 chain from the 2026-08-20 adversarial review.
//
// THE CHAIN
// u/WillowEmberly asked for "the smallest successful exploit chain that crosses from model output to
// irreversible host effect". Verified answer: TWO hops at Medium risk tolerance, with no human.
//
//   1. fs.write  <project>/evil.test.js   -> in-boundary, not a secret path, tier medium, score 40
//                                            <= the Medium ceiling of 70, so AUTO-ALLOWED.
//   2. run_tests                          -> exec, tier high, score 60, also <= 70, AUTO-ALLOWED.
//      The PEP runs `node --test`, which executes every test file in the tree -- including the one
//      just written. Arbitrary code execution as the user.
//
// WHY THE EXISTING DEFENCES DID NOT CATCH IT
// The T-05 command-template hardening is sound and does its job: it stops `package.json` being the
// entry point, pins the binary, scrubs env, disables git hooks. But the payload here is an ORDINARY
// PROJECT FILE, and running project test files is the tool's entire purpose. Nothing was subverted.
// Each hop is individually reasonable; only the SEQUENCE is an attack.
//
// THE CONTROL
// Within one task, if the agent wrote a file that the exec tool it is now asking to run would
// execute, that call requires a human -- and, crucially, RISK TOLERANCE CANNOT SATISFY IT. Writing a
// test and then running it is a legitimate developer workflow, so this deliberately does not deny;
// it removes the ability to complete the loop with nobody watching. One approval, once.
//
// This is the same shape as the existing F1 fix in pdp.ts, where a shell command that reads a secret
// path is forced to ASK regardless of tolerance. Precedent, not a new concept: a floor is a thing
// that convenience settings may not lift.
import { basename } from 'node:path';

/** Files a project test runner will pick up and execute by discovery. */
const RUNNER_EXECUTABLE = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,        // foo.test.ts, foo.spec.mjs, ...
  /(^|[\\/])conftest\.py$/i,              // pytest hook file — executed on collection
  /(^|[\\/])test_[^\\/]+\.py$/i,          // pytest discovery
  /[^\\/]+_test\.(py|go)$/i,              // pytest / go test discovery
];
/** Directories whose contents a runner will sweep. */
const RUNNER_DIRS = /(^|[\\/])(__tests__|test|tests|spec)([\\/]|$)/i;

/**
 * Would a test runner execute this path if it swept the project?
 * Deliberately over-inclusive: a false positive costs one operator approval, a false negative costs
 * arbitrary code execution. The asymmetry decides the tuning.
 */
export function isRunnerExecutable(path: string): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, '/');
  if (RUNNER_EXECUTABLE.some((re) => re.test(basename(p)))) return true;
  // a source file dropped inside a test directory is swept too
  if (RUNNER_DIRS.test(p) && /\.[cm]?[jt]sx?$/i.test(p)) return true;
  return false;
}

/** Exec tools that execute project files by discovery, and so can be aimed by a prior write. */
const RUNNER_TOOLS = new Set(['run_tests', 'test', 'npm_test', 'node_test', 'pytest', 'vitest', 'jest']);
export function isRunnerTool(toolId: string): boolean {
  const t = toolId.toLowerCase();
  if (RUNNER_TOOLS.has(t)) return true;
  return /(^|[._-])(test|spec)s?([._-]|$)/.test(t);
}

/**
 * Per-task ledger of writes that a runner would later execute.
 *
 * Scoped BY TASK on purpose. The dangerous property is "the same unit of work both authored and ran
 * the code" — a file written by an earlier, separately-approved task is part of the project, and
 * treating it as tainted forever would make the control unusable.
 */
export class ExecProvenance {
  private byTask = new Map<string, Set<string>>();

  /** Record an ALLOWED write. Called by the PDP after a write clears every other gate. */
  note(taskId: string | undefined, path: string): void {
    if (!taskId || !isRunnerExecutable(path)) return;
    const set = this.byTask.get(taskId) ?? new Set<string>();
    set.add(path);
    this.byTask.set(taskId, set);
  }

  /** Runner-executable files this task has written, newest-insertion last. */
  wrote(taskId: string | undefined): string[] {
    if (!taskId) return [];
    return [...(this.byTask.get(taskId) ?? [])];
  }

  /** Has this task authored code that `toolId` would execute? */
  selfAuthored(taskId: string | undefined, toolId: string): string[] {
    if (!isRunnerTool(toolId)) return [];
    return this.wrote(taskId);
  }

  clear(taskId: string): void { this.byTask.delete(taskId); }
  snapshot(): { taskId: string; paths: string[] }[] {
    return [...this.byTask.entries()].map(([taskId, paths]) => ({ taskId, paths: [...paths] }));
  }
  restore(arr: { taskId: string; paths: string[] }[]): void {
    this.byTask = new Map((arr ?? []).map((e) => [e.taskId, new Set(e.paths)]));
  }
}
