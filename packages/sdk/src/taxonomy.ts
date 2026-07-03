// Pluggable tool taxonomy: map a host's tool vocabulary onto the governed vocabulary (fs.read/fs.write/
// fs.list/shell/net). Unknown host tools pass through unchanged so the PDP default-denies them.
export interface ToolTaxonomy { map(hostTool: string, input: Record<string, unknown>): { tool: string; input: Record<string, unknown> } }
export interface TaxonomyRule { governed: string; pathKeys?: string[] }

export function makeTaxonomy(rules: Record<string, TaxonomyRule>): ToolTaxonomy {
  return {
    map(hostTool, input) {
      const r = rules[hostTool];
      if (!r) return { tool: hostTool, input };   // unknown -> passthrough -> default-deny
      const keys = r.pathKeys ?? ['path', 'file', 'file_path', 'notebook_path'];
      const key = keys.find((k) => typeof input[k] === 'string');
      const out = key && key !== 'path' ? { ...input, path: input[key] } : input;
      return { tool: r.governed, input: out };
    },
  };
}

// A sensible default for common host naming; hosts can supply their own via makeTaxonomy.
export const DEFAULT_TAXONOMY: ToolTaxonomy = makeTaxonomy({
  ReadFile: { governed: 'fs.read' }, Read: { governed: 'fs.read' },
  WriteFile: { governed: 'fs.write' }, Write: { governed: 'fs.write' }, Edit: { governed: 'fs.write' },
  ListDir: { governed: 'fs.list' }, LS: { governed: 'fs.list' },
  Shell: { governed: 'shell' }, Bash: { governed: 'shell' },
  Fetch: { governed: 'net' }, WebFetch: { governed: 'net' },
});
