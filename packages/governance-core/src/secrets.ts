// Secret-scoped governance — ".env and friends." Two rules: (1) READING a secret file is denied by
// default (deny-by-default for secret access — even though a file read is normally "low"), allowed
// only by an explicit operator grant; (2) secret VALUES must never leave in audit/egress/context, so
// they are detectable + redactable. Deterministic; one source of truth for "what is a secret."
import type { RiskTier } from './types';

// Normalize a path for secret classification. Fold '\'→'/', then defeat Windows filename tricks that
// open the SAME underlying file but dodge a naive suffix match: NTFS alternate data streams
// ('.env::$DATA', 'secret.pem:hidden') and trailing dots/spaces ('.env.', '.env ') all resolve to the
// base name on Windows, so they must classify as the secret they are. Applied on the basename only, so
// a drive letter ('C:/…') and directory colons are preserved. Deny-safe: erring toward "is a secret".
const norm = (p: string): string => {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  const dir = i >= 0 ? s.slice(0, i + 1) : '';
  let base = i >= 0 ? s.slice(i + 1) : s;
  base = base.replace(/:.*$/, '');    // strip NTFS ADS suffix (name:stream[:$DATA])
  base = base.replace(/[ .]+$/, '');  // strip Windows trailing dots/spaces
  return dir + base;
};

/** Paths that are secrets by virtue of WHAT THEY ARE (name/location), regardless of content. */
const SECRET_PATH: { re: RegExp; why: string }[] = [
  { re: /(^|\/)\.env(\.[\w.-]+)?$/i, why: '.env file' },
  { re: /(^|\/)\.npmrc$/i, why: '.npmrc (registry tokens)' },
  { re: /(^|\/)\.git-credentials$/i, why: 'git credentials' },
  { re: /(^|\/)\.netrc$/i, why: '.netrc' },
  { re: /(^|\/)\.pgpass$/i, why: 'pgpass' },
  { re: /(^|\/)\.htpasswd$/i, why: 'htpasswd' },
  { re: /\.(pem|key|p12|pfx|keystore|jks)$/i, why: 'key/cert material' },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/i, why: 'SSH private key' },
  { re: /(^|\/)\.ssh\//i, why: '.ssh directory' },
  { re: /(^|\/)\.aws\/(credentials|config)$/i, why: 'AWS credentials' },
  { re: /(^|\/)\.kube\/config$/i, why: 'kubeconfig' },
  { re: /(^|\/)\.docker\/config\.json$/i, why: 'docker auth' },
  { re: /(^|\/)credentials?\.(json|ya?ml|yml|ini|toml)$/i, why: 'credentials file' },
  { re: /(^|\/)secrets?\.(json|ya?ml|yml|ini|toml|txt|env)$/i, why: 'secrets file' },
];

export function classifyPath(path: string): { secret: boolean; why?: string } {
  const p = norm(path);
  for (const s of SECRET_PATH) if (s.re.test(p)) return { secret: true, why: s.why };
  return { secret: false };
}
export function isSecretPath(path: string): boolean { return classifyPath(path).secret; }

/** Secret VALUES by shape — used to block/redact secrets in transit (egress, audit, context). */
const SECRET_VALUE: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, label: 'private-key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'aws-access-key' },
  { re: /\bsk-[A-Za-z0-9-_]{16,}\b/g, label: 'api-key' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/g, label: 'github-token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, label: 'slack-token' },
  { re: /\bAIza[0-9A-Za-z\-_]{30,}\b/g, label: 'google-api-key' },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: 'jwt' },
  { re: /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|APIKEY)[A-Z0-9_]*[ \t]*[=:][ \t]*\S.*$/gim, label: 'secret-assignment' },
];

/** True if the text appears to contain secret material. */
export function containsSecret(text: string): boolean { return SECRET_VALUE.some((s) => { s.re.lastIndex = 0; return s.re.test(text); }); }

/** Redact secret values in place — for audit/egress/context. Returns the redacted text + what was hit. */
export function redactSecrets(text: string): { redacted: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const s of SECRET_VALUE) {
    out = out.replace(s.re, (m) => {
      // for KEY=VALUE keep the key, redact the value
      if (s.label === 'secret-assignment') { hits.push(s.label); return m.replace(/([=:][ \t]*)\S.*$/, '$1[redacted:secret]'); }
      hits.push(s.label); return `[redacted:${s.label}]`;
    });
  }
  return { redacted: out, hits };
}

/** A grant table: which agent may read which secret paths (operator-set). Default: none. */
export interface SecretPolicy { allowReadByAgent(agentId: string, path: string): boolean }

/** Deny-by-default gate for reading secret files. Allowed only by explicit grant. */
export function secretReadGate(agentId: string, paths: string[], policy?: SecretPolicy): { allow: boolean; tier: RiskTier; reason: string; path?: string } {
  for (const p of paths) {
    const c = classifyPath(p);
    if (c.secret && !(policy?.allowReadByAgent(agentId, p))) {
      return { allow: false, tier: 'critical', reason: `secret-file access denied (${c.why}) — explicit operator grant required`, path: p };
    }
  }
  return { allow: true, tier: 'low', reason: 'no secret files in request' };
}


// ---- .env POISONING DEFENSE ----
// Env vars that are code-execution / hijack primitives or that try to flip Starfish's own governance.
// A write to a secret file containing any of these is rejected even from the gatekeeper.
const DANGEROUS_ENV_KEY: { re: RegExp; why: string }[] = [
  { re: /^[ \t]*(?:export[ \t]+)?NODE_OPTIONS[ \t]*=/im, why: 'NODE_OPTIONS (code injection)' },
  { re: /^[ \t]*(?:export[ \t]+)?(?:LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH)[ \t]*=/im, why: 'loader preload (code injection)' },
  { re: /^[ \t]*(?:export[ \t]+)?GIT_SSH(?:_COMMAND)?[ \t]*=/im, why: 'GIT_SSH_COMMAND (command execution)' },
  { re: /^[ \t]*(?:export[ \t]+)?(?:BROWSER|EDITOR|VISUAL|PAGER|SHELL)[ \t]*=/im, why: 'spawned-program override' },
  { re: /^[ \t]*(?:export[ \t]+)?(?:PYTHONSTARTUP|PYTHONPATH|PERL5LIB|RUBYOPT)[ \t]*=/im, why: 'interpreter hook' },
  { re: /^[ \t]*(?:export[ \t]+)?(?:PROMPT_COMMAND|BASH_ENV|ENV)[ \t]*=/im, why: 'shell init hook' },
  { re: /^[ \t]*(?:export[ \t]+)?PATH[ \t]*=/im, why: 'PATH override' },
  { re: /^[ \t]*(?:export[ \t]+)?(?:ANTHROPIC_BASE_URL|OPENAI_BASE_URL|OPENAI_API_BASE|GOOGLE_[A-Z_]*URL)[ \t]*=/im, why: 'provider endpoint redirect' },
  { re: /^[ \t]*(?:export[ \t]+)?STARFISH_[A-Z0-9_]*[ \t]*=/im, why: 'attempt to set a Starfish governance flag from .env' },
  { re: /--require\b/i, why: '--require injection' },
];

export interface EnvScreen { ok: boolean; findings: string[] }
/** Screen the CONTENT of a .env / secret file for poisoning shapes. Block on any hit. */
export function screenEnv(content: string): EnvScreen {
  const findings: string[] = [];
  for (const d of DANGEROUS_ENV_KEY) if (d.re.test(content)) findings.push(d.why);
  return { ok: findings.length === 0, findings };
}

/** Toby is the gatekeeper: only the designated agent may ADD/MODIFY a secret file, and only with
 *  content that passes screenEnv. Everyone else (and poisoned content) is denied. */
export function secretWriteGate(agentId: string, paths: string[], content: string | undefined, opts: { gatekeeper?: string }): { allow: boolean; tier: RiskTier; reason: string } {
  const secretPaths = paths.filter(isSecretPath);
  if (secretPaths.length === 0) return { allow: true, tier: 'low', reason: 'no secret files in write' };
  if (!opts.gatekeeper || agentId !== opts.gatekeeper)
    return { allow: false, tier: 'critical', reason: `secret-file changes go through the gatekeeper (${opts.gatekeeper ?? 'unset'}) — ${agentId} denied` };
  if (content) { const sc = screenEnv(content); if (!sc.ok) return { allow: false, tier: 'critical', reason: `poisoned secret content rejected: ${sc.findings.join('; ')}` }; }
  return { allow: true, tier: 'high', reason: 'gatekeeper write, content screened' };
}
