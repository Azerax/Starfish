# Project Starfish

> **AI governance for agents: a deny-by-default policy layer for Claude Code and agent / skill builds.**
> Everyone ships skills. Nobody ships governance. **Starfish is the governance.**

[![npm](https://img.shields.io/npm/v/project-starfish.svg)](https://www.npmjs.com/package/project-starfish)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/Azerax/Starfish/blob/master/LICENSE)

`project-starfish` is the `starfish` CLI. It puts every AI agent action through a single **Policy Decision
Point** that defaults to **deny**: each tool call is authorized on the way in, contained on the way out,
and written to a tamper-evident **audit log**. No task, no tool. Proposer is never approver. Fail-closed:
if governance is not running, governed tool calls are denied, not allowed.

It is **model-agnostic** (Claude, OpenAI, Gemini, OpenRouter, local) and, as of v0.10.0, it can govern
**Claude Code itself** through its hooks.

Self-contained single-file bundle, no runtime dependencies, local-only. Apache-2.0 (free for personal and
commercial use).

[projectstarfish.ca](https://projectstarfish.ca) · [GitHub](https://github.com/Azerax/Starfish) · [Devlog](https://projectstarfish.ca/blog/)

## Who it is for

AI / platform / security engineers who let agents read, write, run shells, and reach the network, and who
need **agent governance, guardrails, and an audit trail** instead of hope. Useful anywhere you care about
**least privilege, prompt-injection defense, data-exfiltration prevention, policy enforcement, and
compliance** for autonomous and agentic AI.

## What it governs

- **File system** - reads/writes confined to a boundary; writes outside it (or into the governance dir) are denied.
- **Shell / exec** - raw shell asks for approval; catastrophic commands (`rm -rf /`, `curl | sh`, ...) are denied outright.
- **Network / MCP / web** - external sources are admitted-but-tainted; tainted data cannot authorize a tool or exfiltrate.
- **Skills / capabilities** - vetted and risk-rated before they can run; deny-by-default for anything unregistered.
- **Secrets / `.env`** - read deny-by-default; add/remove gatekept.
- **Deletion** - impact-assessed, soft (recoverable), with hard rules (no system files, no folders, no skill files).

## Install

```bash
npm install -g project-starfish          # from npm
npm install -g github:Azerax/Starfish    # ...or from GitHub (built on install)
npx project-starfish govern ./my-skill-pack   # ...or run without installing
```

Requires Node.js >= 18.

## Govern Claude Code (deny-by-default overlay)

```bash
cd <your project>
starfish init --overlay --yes       # seed governance under .starfish (project untouched)
starfish install --claude-code      # wire the PreToolUse / PostToolUse hooks
starfish daemon                     # start the resident, fail-closed Policy Decision Point
# now build with Claude Code as normal - every tool call is adjudicated + audited
```

Tamper-resistant, machine-wide lockdown (recommended, needs admin once):

```bash
sudo starfish install --claude-code --managed   # Claude Code then refuses competing hooks/rules/bypass
starfish doctor                                  # audit the lockdown: pins, integrity, perms, daemon
```

Verified against Claude Code 2.1.183.

## Bring an existing skill pack under governance

```bash
starfish govern <pack-dir> [--apply] [--approve id1,id2]
```

`starfish govern` inventories a build, **vets every capability** (static review + provenance +
prompt-injection screen, producing a risk tier), and installs the gate: **Low** auto-registers; **Medium
and up** are quarantined pending your explicit `--approve`.

## Commands

`init` · `govern` · `daemon` · `hook` · `install --claude-code [--managed]` · `uninstall` · `attest` · `doctor`

## Why deny-by-default

Allowlists and one-off permission prompts depend on the agent (and the human) catching every dangerous
call. Starfish does not: nothing executes unless a policy explicitly allows it, every decision is recorded,
and an agent can never approve its own high-risk request. The control does not rely on the agent's
cooperation.

---

Apache-2.0. "Project Starfish" and the Starfish mark are trademarks of the project; the license grants no
trademark rights. Full changelog: [CHANGELOG.md](https://github.com/Azerax/Starfish/blob/master/CHANGELOG.md).
