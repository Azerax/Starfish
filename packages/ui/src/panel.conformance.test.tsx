import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingList, GovernancePanel, type UiBridge } from './index';

describe('embeddable UI (server-render)', () => {
  it('PendingList renders items with approve/deny controls', () => {
    const html = renderToStaticMarkup(
      <PendingList items={[{ id: 'd1', tool: 'fs.write', actor: 'worker', target: '/x', reason: 'needs go' }]} onResolve={() => { /* noop */ }} />,
    );
    expect(html).toContain('worker');
    expect(html).toContain('fs.write');
    expect(html).toContain('needs go');
    expect(html).toContain('Approve');
    expect(html).toContain('Deny');
  });
  it('PendingList shows an empty state', () => {
    expect(renderToStaticMarkup(<PendingList items={[]} onResolve={() => { /* noop */ }} />)).toContain('Nothing awaiting');
  });
  it('GovernancePanel renders without throwing (initial empty)', () => {
    const stub: UiBridge = {
      health: async () => ({ ok: true, wire: 1 }), pending: async () => [], audit: async () => [], budgets: async () => [],
      monitor: async () => ({ counters: { denials: 0, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, safeMode: false }),
      resolve: async () => ({ ok: true, reason: '' }),
    };
    expect(renderToStaticMarkup(<GovernancePanel bridge={stub} />)).toContain('Needs your go');
  });
});
