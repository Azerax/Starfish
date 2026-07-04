import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GovernancePanel, PendingList } from './GovernancePanel';
import type { UiBridge } from './httpBridge';

describe('GovernancePanel SSR', () => {
  it('PendingList shows an empty state', () => {
    expect(renderToStaticMarkup(<PendingList items={[]} onResolve={() => { /* noop */ }} />)).toContain('Nothing awaiting');
  });
  it('GovernancePanel renders without throwing (initial empty)', () => {
    const stub: UiBridge = {
      health: async () => ({ ok: true, wire: 1 }), pending: async () => [], audit: async () => [], budgets: async () => [],
      monitor: async () => ({ counters: { denials: 0, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, safeMode: false }),
      resolve: async () => ({ ok: true, reason: '' }),
      subscribe: () => () => { /* noop */ },
    };
    expect(renderToStaticMarkup(<GovernancePanel bridge={stub} />)).toContain('Needs your go');
  });
});
