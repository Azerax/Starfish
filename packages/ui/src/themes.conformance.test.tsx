import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { THEMES } from './themes';
import type { PendingItem, MonitorView } from './httpBridge';

const items: PendingItem[] = [{ id: 'd1', tool: 'fs.write', actor: 'worker', target: '/x/deploy.yml', reason: 'writing CI', riskTier: 'high' }];
const mon: MonitorView = { counters: { denials: 2, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, safeMode: false };

describe('launch themes (5 choices)', () => {
  it('ships exactly the 5 launch themes', () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual(['calm', 'command', 'radar', 'terminal', 'vault']);
  });
  for (const t of THEMES) {
    it(`${t.id} renders the item with an approve/clear control`, () => {
      const html = renderToStaticMarkup(<t.Component items={items} monitor={mon} onResolve={() => { /* noop */ }} />);
      expect(html).toContain('worker');
      expect(html).toContain('fs.write');
      expect(html.toLowerCase()).toMatch(/approve|cleared|turn key/);
    });
    it(`${t.id} renders an empty state without throwing`, () => {
      expect(() => renderToStaticMarkup(<t.Component items={[]} monitor={mon} onResolve={() => { /* noop */ }} />)).not.toThrow();
    });
  }
});
