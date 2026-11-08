// H3 — production-target guard (HARDENING_BACKLOG.md). Risk category #26 ("production vs non-production
// target") had no producer at all, so nothing distinguished `kubectl apply` against a throwaway cluster
// from the same command against production. This module is that producer: a pure classifier over a
// shell command's text.
//
// Scope, stated so it is not overclaimed:
//   - It only looks at EXEC calls (shell commands), where deploy CLIs, database clients and ssh run.
//     A network tool's URL and a file write are not classified here.
//   - It only fires when the command names a deployment TARGET: a deploy/cloud CLI, a database
//     connection URI, ssh to a host, or a database client given an explicit host. A command with no
//     target returns undefined and category #26 stays unscored, so ordinary work is unaffected.
//   - When a target IS named but carries no environment marker, it is classified 'prod'. That is the
//     fail-closed direction: an unlabelled target is the one a person must look at.
//   - A production marker anywhere wins over a non-production one (`--context prod apply -f test.yaml`
//     is prod). A non-production word inside a file name (`staging.yaml`) does not count.
//   - It is a heuristic over text. It does not resolve kube contexts, cloud profiles or DNS.
//
// Parsing is done by splitting into segments and tokens in code, not with one large regex: every
// pattern below is linear, because the input is agent-controlled (see the CodeQL js/polynomial-redos
// fixes in handler.ts and inquiry.ts).
import type { DeployEnvironment } from './controlplane';

export interface TargetReading {
  env: DeployEnvironment;
  /** false when every targeted command only reads (get/describe/list/plan) or is a dry run. */
  consequential: boolean;
  evidence: string;
}

const DEPLOY_CLIS = new Set(['kubectl', 'oc', 'helm', 'terraform', 'tofu', 'pulumi', 'vercel', 'netlify', 'wrangler', 'flyctl', 'fly', 'heroku', 'serverless', 'sls', 'cdk', 'gcloud', 'aws', 'az', 'doctl', 'railway', 'ansible-playbook']);
const DB_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'mongosh', 'mongo', 'redis-cli', 'sqlcmd', 'pg_dump', 'pg_restore', 'mysqldump']);
const PREFIXES = new Set(['sudo', 'npx', 'exec', 'env', 'time', 'nohup', 'command']);
const DB_SCHEMES = new Set(['postgres', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'amqp', 'amqps', 'mssql', 'sqlserver']);
// ssh options that take a value (the next token is not the destination).
const SSH_VALUE_OPTS = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w', '-B']);
// kubectl/oc global flags that take a value, so the verb is found after them.
const KUBE_VALUE_OPTS = new Set(['-n', '--namespace', '--context', '--cluster', '--kubeconfig', '-l', '--selector', '-o', '--output', '--user', '-s', '--server', '--as']);
const KUBE_READ = new Set(['get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources', 'api-versions', 'cluster-info', 'auth', 'diff']);
const TF_READ = new Set(['plan', 'show', 'validate', 'fmt', 'output', 'providers', 'version', 'graph', 'state']);
const HELM_READ = new Set(['list', 'ls', 'status', 'get', 'lint', 'show', 'history', 'search', 'version', 'template', 'diff']);
const PULUMI_READ = new Set(['preview', 'whoami', 'version']);

const LOCAL_HOST = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|::1|\[::1\]|host\.docker\.internal)$/i;
const LOCAL_SUFFIX = /\.(?:local|localhost|test)$/i;
const PROD_MARKER = /(?:^|[^a-z0-9])(prod|production|prd)(?![a-z0-9])/i;
const STAGING_MARKER = /(?:^|[^a-z0-9])(staging|stage|stg|uat|preview|preprod)(?![a-z0-9])/i;
const DEV_MARKER = /(?:^|[^a-z0-9])(dev|develop|development|test|testing|qa|sandbox|local|localhost|minikube|kind|docker-desktop|ephemeral)(?![a-z0-9])/i;
const FILE_EXT = /\.(?:ya?ml|json|tf|tfvars|sql|sh|ps1|py|js|ts|env|txt|md|cfg|conf|ini|toml|hcl)$/i;

const isLocal = (h: string): boolean => LOCAL_HOST.test(h) || LOCAL_SUFFIX.test(h);
const base = (t: string): string => {
  const cut = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  return t.slice(cut + 1).toLowerCase().replace(/\.exe$/, '');
};

/** host from `scheme://[user[:pass]@]host[:port][/...]`, or undefined when the token is not a DB URI. */
function hostFromUri(token: string): string | undefined {
  const sep = token.indexOf('://');
  if (sep <= 0) return undefined;
  if (!DB_SCHEMES.has(token.slice(0, sep).toLowerCase())) return undefined;
  let rest = token.slice(sep + 3);
  const slash = rest.indexOf('/'); if (slash >= 0) rest = rest.slice(0, slash);
  const at = rest.lastIndexOf('@'); if (at >= 0) rest = rest.slice(at + 1);
  if (rest.startsWith('[')) { const end = rest.indexOf(']'); return end > 0 ? rest.slice(0, end + 1) : rest; }
  const colon = rest.indexOf(':'); if (colon >= 0) rest = rest.slice(0, colon);
  return rest || undefined;
}

/** First non-option token after index `from`, skipping options and, for value-taking flags, their value. */
function firstOperand(tokens: string[], from: number, valueOpts: Set<string>): { word: string; at: number } | undefined {
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-')) { if (!t.includes('=') && valueOpts.has(t)) i++; continue; }
    return { word: t, at: i };
  }
  return undefined;
}

interface SegmentTarget { what: string; host?: string; consequential: boolean }

function readSegment(tokens: string[]): SegmentTarget[] {
  const out: SegmentTarget[] = [];
  for (const t of tokens) { const h = hostFromUri(t); if (h) out.push({ what: `host ${h}`, host: h, consequential: true }); }
  let i = 0;
  while (i < tokens.length && (tokens[i].includes('=') && !tokens[i].startsWith('-') || PREFIXES.has(base(tokens[i])))) i++;
  if (i >= tokens.length) return out;
  const cmd = base(tokens[i]);
  const dryRun = tokens.some((t) => t === '--dry-run' || t.startsWith('--dry-run=') || t === '--what-if');

  if (DEPLOY_CLIS.has(cmd)) {
    let read = false;
    if (cmd === 'kubectl' || cmd === 'oc') {
      const v = firstOperand(tokens, i + 1, KUBE_VALUE_OPTS);
      if (v) read = KUBE_READ.has(v.word) || (v.word === 'config' && ['view', 'get-contexts', 'current-context'].includes(tokens[v.at + 1] ?? ''));
    } else if (cmd === 'terraform' || cmd === 'tofu') {
      const v = firstOperand(tokens, i + 1, new Set());
      if (v) read = TF_READ.has(v.word) && (v.word !== 'state' || ['list', 'show'].includes(tokens[v.at + 1] ?? ''));
    } else if (cmd === 'helm') {
      const v = firstOperand(tokens, i + 1, new Set(['-n', '--namespace', '--kube-context']));
      if (v) read = HELM_READ.has(v.word);
    } else if (cmd === 'pulumi') {
      const v = firstOperand(tokens, i + 1, new Set(['-s', '--stack', '-C', '--cwd']));
      if (v) read = PULUMI_READ.has(v.word);
    } else if (cmd === 'aws') {
      const svc = firstOperand(tokens, i + 1, new Set(['--profile', '--region', '--output']));
      const op = svc ? firstOperand(tokens, svc.at + 1, new Set(['--profile', '--region', '--output'])) : undefined;
      if (op) read = /^(?:describe|list|get)-/.test(op.word);
    } else if (cmd === 'gcloud') {
      read = tokens.slice(i + 1).some((t) => t === 'list' || t === 'describe');
    } else if (cmd === 'az') {
      read = tokens.slice(i + 1).some((t) => t === 'list' || t === 'show');
    }
    out.push({ what: cmd, consequential: !(read || dryRun) });
  } else if (cmd === 'ssh') {
    const dest = firstOperand(tokens, i + 1, SSH_VALUE_OPTS);
    if (dest) { const at = dest.word.lastIndexOf('@'); const h = at >= 0 ? dest.word.slice(at + 1) : dest.word; if (h) out.push({ what: `ssh ${h}`, host: h, consequential: true }); }
  } else if (DB_CLIENTS.has(cmd)) {
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      let h: string | undefined;
      if (t === '-h' || t === '--host' || t === '-S' || t === '--server') h = tokens[j + 1];
      else if (t.startsWith('--host=') || t.startsWith('--server=')) h = t.slice(t.indexOf('=') + 1);
      else if (t.length > 2 && t.startsWith('-h') && !t.startsWith('--')) h = t.slice(2);
      if (h) { out.push({ what: `${cmd} ${h}`, host: h, consequential: true }); break; }
    }
  }
  return out;
}

/** Classify the deployment target a shell command names, or undefined when it names none. */
export function classifyTarget(command: string): TargetReading | undefined {
  const text = command.length > 8192 ? command.slice(0, 8192) : command;   // a deploy line is never longer
  const segments = text.split(/&&|\|\||[;|\n`]|\$\(/);
  const targets: SegmentTarget[] = [];
  for (const seg of segments) targets.push(...readSegment(seg.split(/[\s'"(),]+/).filter(Boolean)));
  if (targets.length === 0) return undefined;

  const consequential = targets.some((t) => t.consequential);
  const what = targets[0].what;
  const prod = PROD_MARKER.exec(text);
  if (prod) return { env: 'prod', consequential, evidence: `${what}: production marker "${prod[1]}"` };

  // Non-production words count only outside file names: `-f staging.yaml` says nothing about the target.
  const outsideFiles = text.split(/[\s'"=,]+/).filter((t) => !FILE_EXT.test(t)).join(' ');
  const stg = STAGING_MARKER.exec(outsideFiles);
  if (stg) return { env: 'staging', consequential, evidence: `${what}: staging marker "${stg[1]}"` };
  const dev = DEV_MARKER.exec(outsideFiles);
  if (dev) return { env: 'dev', consequential, evidence: `${what}: non-production marker "${dev[1]}"` };
  // Only host-based targets, all local: a local database or machine.
  if (targets.every((t) => t.host !== undefined && isLocal(t.host))) return { env: 'dev', consequential, evidence: `${what}: local host` };
  return { env: 'prod', consequential, evidence: `${what}: no environment marker, treated as production` };
}
