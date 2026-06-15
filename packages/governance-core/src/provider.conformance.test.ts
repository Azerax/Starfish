import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type Provider } from './index';

describe('provider registry — model-agnostic governance', () => {
  it('defaults to Anthropic', () => {
    const r = new ProviderRegistry();
    expect(r.active().id).toBe('anthropic');
    expect(r.active().model).toBe('claude-opus-4-8');
  });
  it('accepts and selects a custom provider (e.g. a local OpenAI-compatible endpoint)', () => {
    const r = new ProviderRegistry();
    r.register({ id: 'local', name: 'Local', kind: 'local', model: 'llama-3', baseUrl: 'http://127.0.0.1:11434/v1', requiresKey: false } as Provider);
    expect(r.setActive('local').baseUrl).toContain('11434');
  });
  it('rejects an unknown provider (fail-closed)', () => {
    expect(() => new ProviderRegistry().setActive('nope')).toThrow();
  });
  it('the provider model NEVER carries the api key', () => {
    const p = new ProviderRegistry().active() as unknown as Record<string, unknown>;
    expect('apiKey' in p).toBe(false); expect('key' in p).toBe(false); expect('secret' in p).toBe(false);
  });
});
