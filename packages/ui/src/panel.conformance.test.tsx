import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GovernancePanel, PendingList, DeliberateConfirm } from './GovernancePanel';
import type { UiBridge, PendingItem } from './httpBridge';

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
  it('H6: a deliberate item is marked in the list, and its confirm dialog starts with Approve disabled', () => {
    const item: PendingItem = { id: 'd1', tool: 'shell', actor: 'worker', target: 'drop table users', riskTier: 'critical', askOrigin: 'floor', confirmation: 'deliberate' };
    expect(renderToStaticMarkup(<PendingList items={[item]} onResolve={() => { /* noop */ }} />)).toContain('needs typed confirmation');
    const html = renderToStaticMarkup(<DeliberateConfirm item={item} onConfirm={() => { /* noop */ }} onCancel={() => { /* noop */ }} />);
    expect(html).toContain('A floor category requires a person');
    expect(html).toMatch(/<button type="button" disabled="">Approve<\/button>/);
  });
});
