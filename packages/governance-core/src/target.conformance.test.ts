// H3 — production-target guard (HARDENING_BACKLOG.md). Category #26 had no producer, so a deploy to
// production looked like any other shell command. These pin the classifier, the floor it drives, and
// the cases it deliberately leaves alone.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyTarget } from './target';
import { RiskEngine } from './risk';
import { loadGovernor } from './boot';
import { confirmationClass } from './confirmation';
import type { BoundarySet, ToolDef } from './types';

const env = (c: string): string | undefined => classifyTarget(c)?.env;
const cons = (c: string): boolean | undefined => classifyTarget(c)?.consequential;

describe('H3 — no target, no classification (ordinary work is unaffected)', () => {
  it.each([
    'npm run build', 'git status', 'ls -la', 'echo prod', 'cat prod.yaml', 'psql mydb -c "select 1"',
    'python manage.py migrate', 'grep -r production src/',
  ])('%s', (c) => { expect(classifyTarget(c)).toBeUndefined(); });
});

describe('H3 — targets are classified, failing closed to prod', () => {
  it('a deploy CLI with no environment marker is production', () => {
    expect(env('kubectl apply -f deploy.yaml')).toBe('prod');
    expect(env('terraform apply -auto-approve')).toBe('prod');
    expect(env('npx wrangler deploy')).toBe('prod');
    expect(env('sudo kubectl rollout restart deploy/api')).toBe('prod');
    expect(env('KUBECONFIG=/tmp/k kubectl apply -f x.yaml')).toBe('prod');
  });

  it('a remote database URI, ssh host, or database client host is a target', () => {
    expect(env('psql postgres://app:secret@db.example.com:5432/app -c "update users set x=1"')).toBe('prod');
    expect(env("ssh -i key.pem deploy@web1.example.com 'systemctl restart app'")).toBe('prod');
    expect(env('psql -h db.example.com -U app -c "delete from jobs"')).toBe('prod');
    expect(env('mysql --host=db.example.com app')).toBe('prod');
  });

  it('a production marker wins over any non-production one', () => {
    expect(env('kubectl --context prod apply -f test.yaml')).toBe('prod');
    expect(env('helm upgrade api ./chart -n production --set env=dev')).toBe('prod');
    expect(env('psql -h db.prd.example.com')).toBe('prod');
  });

  it('staging and dev markers are recognised', () => {
    expect(env('kubectl --context staging apply -f x.yaml')).toBe('staging');
    expect(env('helm upgrade api ./chart --kube-context stg')).toBe('staging');
    expect(env('kubectl --context minikube apply -f x.yaml')).toBe('dev');
    expect(env('wrangler dev')).toBe('dev');
  });

  it('local hosts are dev', () => {
    expect(env('psql -h localhost -c "drop table t"')).toBe('dev');
    expect(env('psql postgres://u@127.0.0.1:5432/db')).toBe('dev');
    expect(env('ssh build@runner.local make')).toBe('dev');
  });

  it('a non-production word in a FILE NAME does not make the target non-production', () => {
    expect(env('kubectl apply -f staging.yaml')).toBe('prod');
    expect(env('kubectl apply -f k8s/dev-values.yml')).toBe('prod');
  });
});

describe('H3 — read-only and dry-run calls are not consequential', () => {
  it('reads', () => {
    expect(cons('kubectl get pods')).toBe(false);
    expect(cons('kubectl -n prod --context prod get pods -o wide')).toBe(false);
    expect(cons('kubectl logs deploy/api')).toBe(false);
    expect(cons('terraform plan')).toBe(false);
    expect(cons('helm list -A')).toBe(false);
    expect(cons('aws s3api list-buckets')).toBe(false);
    expect(cons('gcloud compute instances list')).toBe(false);
    expect(cons('kubectl get pods | grep api')).toBe(false);
  });
  it('writes, dry runs, and chains', () => {
    expect(cons('kubectl apply --dry-run=client -f x.yaml')).toBe(false);
    expect(cons('kubectl delete ns api')).toBe(true);
    expect(cons('terraform state rm aws_instance.web')).toBe(true);
    expect(cons('aws s3 cp build/ s3://site --recursive')).toBe(true);
    expect(cons('kubectl get pods && kubectl delete ns api')).toBe(true);
  });
});

describe('H3 — linear on hostile input', () => {
  it('long, repetitive commands classify quickly', () => {
    const t0 = Date.now();
    classifyTarget('kubectl ' + '-a '.repeat(100_000));
    classifyTarget('psql ' + 'postgres://'.repeat(20_000));
    classifyTarget('ssh ' + '-o '.repeat(100_000));
    classifyTarget('x'.repeat(200_000) + '.yaml prod');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('H3 — #26 drives a floor through the real PDP', () => {
  const SHELL: ToolDef = { id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' } as ToolDef;

  it('the risk engine scores #26 only for exec calls', () => {
    const r = new RiskEngine();
    expect(r.assess({ agentId: 'w', tool: 'shell', input: { command: 'kubectl apply -f x.yaml' } }, SHELL).floors).toContain(26);
    expect(r.assess({ agentId: 'w', tool: 'shell', input: { command: 'kubectl get pods' } }, SHELL).floors).not.toContain(26);
    expect(r.assess({ agentId: 'w', tool: 'shell', input: { command: 'kubectl --context staging apply -f x.yaml' } }, SHELL).floors).not.toContain(26);
    const write: ToolDef = { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' } as ToolDef;
    expect(r.assess({ agentId: 'w', tool: 'fs.write', input: { path: 'prod.yaml', content: 'kubectl apply' } }, write).floors).not.toContain(26);
  });

  function gov(): { g: ReturnType<typeof loadGovernor>; bs: BoundarySet } {
    const d = mkdtempSync(join(tmpdir(), 'sf-target-')); const dir = join(d, 'governance'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' }]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
    // An explicit ALLOW for shell: the floor must outrank it (F-12 ordering).
    writeFileSync(join(dir, 'policies.json'), JSON.stringify([{ id: 'allow-shell', subject: 'agent:worker', action: 'tool:shell', resource: '*', effect: 'allow' }]));
    return { g: loadGovernor(dir, join(d, 'audit.jsonl')), bs: { visibility: [d], write: [d] } };
  }

  it('a consequential production command is an Ask with origin "floor", even under an allow policy and medium tolerance', () => {
    const { g, bs } = gov();
    g.pdp.setRiskTolerance('medium');
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'kubectl apply -f deploy.yaml' } }, bs);
    expect(d.allow).toBe(false);
    expect(d.ask).toBe(true);
    expect(d.askOrigin).toBe('floor');
    // and H6 classes it deliberate, so one routine click cannot approve it
    expect(confirmationClass({ riskTier: d.riskTier, askOrigin: d.askOrigin })).toBe('deliberate');
  });

  it('the same allow policy still runs staging deploys and production reads (no new friction there)', () => {
    const { g, bs } = gov();
    expect(g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'kubectl --context staging apply -f x.yaml' } }, bs).allow).toBe(true);
    expect(g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'kubectl get pods' } }, bs).allow).toBe(true);
    expect(g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'npm run build' } }, bs).allow).toBe(true);
  });
});
