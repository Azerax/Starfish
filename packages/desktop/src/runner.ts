// Agent runner seam (T-25 plug point). The default runner confines an agent to its worktree with a
// scrubbed environment and a default-deny posture; an OS-level runner (restricted user / container)
// implements the same interface and is dropped in where real kernel confinement is available.
export interface AgentRunSpec { agentId: string; command: string; args: string[]; worktree: string; }
export interface RunPlan { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; }
export interface AgentRunner { plan(spec: AgentRunSpec): RunPlan; }

// Only these env vars survive into an agent process — secrets/credentials are never inherited.
const KEEP = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'SystemRoot'];

export class WorktreeRunner implements AgentRunner {
  plan(spec: AgentRunSpec): RunPlan {
    const env: NodeJS.ProcessEnv = {};
    for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
    env.STARFISH_AGENT = spec.agentId;          // identity for the hook handshake
    return { command: spec.command, args: spec.args, cwd: spec.worktree, env };   // cwd confined to worktree
  }
}
