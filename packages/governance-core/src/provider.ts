// Provider model — Starfish is model-agnostic. Governance is the constant; the LLM is swappable.
// A Provider is a DEFINITION (which model/endpoint). The API KEY is a secret held by the host
// (OS keychain), never in the core, the registry, the audit, or any skill's boundary/env.
import { GovernanceError } from './types';

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'local' | 'router' | 'custom';

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;          // default model for this provider (or a router policy id)
  baseUrl?: string;       // for local / OpenAI-compatible / router endpoints
  requiresKey: boolean;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export interface ChatTurn { role: ChatRole; content: string; }
export type AuthScheme = 'bearer' | 'x-api-key' | 'query' | 'none';

/** A fully-formed HTTP request the HOST sends — except the secret. The adapter declares WHERE the
 *  key goes (`authScheme` / `authHeader` / `authQuery`) but NEVER embeds it; the host injects the
 *  key from the OS keychain at send time. So no key ever touches core, audit, or a request object. */
export interface RuntimeRequest {
  providerId: string; kind: ProviderKind; method: 'POST'; url: string; model: string;
  headers: Record<string, string>; authScheme: AuthScheme; authHeader?: string; authQuery?: string;
  body: unknown;
}
export interface BuildRequestInput { provider: Provider; model: string; system?: string; messages: ChatTurn[]; }

/** Contract an agent-runtime adapter implements to drive a provider through the governed loop.
 *  Every tool call the model makes is still adjudicated by the PDP, regardless of provider. */
export interface AgentRuntimeAdapter {
  readonly providerKind: ProviderKind;
  readonly id: string;
  buildRequest(input: BuildRequestInput): RuntimeRequest;
}

const trimUrl = (u?: string, fb = ''): string => (u ?? fb).replace(/\/+$/, '');

/** Anthropic Messages API. Key -> `x-api-key` header (host-injected). */
export const anthropicAdapter: AgentRuntimeAdapter = {
  providerKind: 'anthropic', id: 'adapter:anthropic',
  buildRequest({ provider, model, system, messages }) {
    return { providerId: provider.id, kind: 'anthropic', method: 'POST',
      url: `${trimUrl(provider.baseUrl, 'https://api.anthropic.com')}/v1/messages`, model,
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      authScheme: 'x-api-key', authHeader: 'x-api-key',
      body: { model, max_tokens: 4096, system, messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })) } };
  },
};
/** OpenAI (and OpenAI-compatible) Chat Completions. Key -> Bearer. */
export const openaiAdapter: AgentRuntimeAdapter = {
  providerKind: 'openai', id: 'adapter:openai',
  buildRequest({ provider, model, system, messages }) {
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    return { providerId: provider.id, kind: 'openai', method: 'POST',
      url: `${trimUrl(provider.baseUrl, 'https://api.openai.com/v1')}/chat/completions`, model,
      headers: { 'content-type': 'application/json' }, authScheme: 'bearer', authHeader: 'authorization',
      body: { model, messages: msgs } };
  },
};
/** Google Gemini generateContent. Key -> `x-goog-api-key` header (host-injected). */
export const googleAdapter: AgentRuntimeAdapter = {
  providerKind: 'google', id: 'adapter:google',
  buildRequest({ provider, model, system, messages }) {
    return { providerId: provider.id, kind: 'google', method: 'POST',
      url: `${trimUrl(provider.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')}/models/${model}:generateContent`, model,
      headers: { 'content-type': 'application/json' }, authScheme: 'x-api-key', authHeader: 'x-goog-api-key',
      body: { systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) } };
  },
};
/** Local OpenAI-compatible endpoint (Ollama / llama.cpp / vLLM). No key. */
export const localAdapter: AgentRuntimeAdapter = {
  providerKind: 'local', id: 'adapter:local',
  buildRequest({ provider, model, system, messages }) {
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    return { providerId: provider.id, kind: 'local', method: 'POST',
      url: `${trimUrl(provider.baseUrl, 'http://localhost:11434/v1')}/chat/completions`, model,
      headers: { 'content-type': 'application/json' }, authScheme: 'none', body: { model, messages: msgs } };
  },
};
/** Hosted router (OpenRouter): OpenAI-compatible, Bearer. DATA-EGRESS — host gates on operator opt-in. */
export const routerAdapter: AgentRuntimeAdapter = {
  providerKind: 'router', id: 'adapter:router',
  buildRequest({ provider, model, system, messages }) {
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    return { providerId: provider.id, kind: 'router', method: 'POST',
      url: `${trimUrl(provider.baseUrl, 'https://openrouter.ai/api/v1')}/chat/completions`, model,
      headers: { 'content-type': 'application/json' }, authScheme: 'bearer', authHeader: 'authorization',
      body: { model, messages: msgs } };
  },
};

/** Resolves a provider kind to its runtime adapter. */
export class AdapterRegistry {
  private byKind = new Map<ProviderKind, AgentRuntimeAdapter>();
  constructor(initial: AgentRuntimeAdapter[] = DEFAULT_ADAPTERS) { for (const a of initial) this.register(a); }
  register(a: AgentRuntimeAdapter): void { this.byKind.set(a.providerKind, a); }
  has(kind: ProviderKind): boolean { return this.byKind.has(kind); }
  for(kind: ProviderKind): AgentRuntimeAdapter { const a = this.byKind.get(kind); if (!a) throw new GovernanceError(`no runtime adapter for provider kind: ${kind}`); return a; }
}

export const ANTHROPIC: Provider = { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'https://api.anthropic.com', requiresKey: true };
export const OPENAI: Provider = { id: 'openai', name: 'OpenAI', kind: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', requiresKey: true };
export const GOOGLE: Provider = { id: 'google', name: 'Google (Gemini)', kind: 'google', model: 'gemini-1.5-pro', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', requiresKey: true };
export const LOCAL: Provider = { id: 'local', name: 'Local (OpenAI-compatible)', kind: 'local', model: 'llama-3.1', baseUrl: 'http://localhost:11434/v1', requiresKey: false };
// A router-as-provider: one key fans out to many models. A hosted router sends prompts to a third
// party (data-egress) — gate behind explicit operator opt-in + egress containment.
export const OPENROUTER: Provider = { id: 'openrouter', name: 'OpenRouter (multi-model)', kind: 'router', model: 'openrouter/auto', baseUrl: 'https://openrouter.ai/api/v1', requiresKey: true };
export const AVAILABLE_PROVIDERS: Provider[] = [ANTHROPIC, OPENAI, GOOGLE, OPENROUTER, LOCAL];
export const DEFAULT_ADAPTERS: AgentRuntimeAdapter[] = [anthropicAdapter, openaiAdapter, googleAdapter, localAdapter, routerAdapter];

export class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private activeId: string;
  constructor(initial: Provider[] = [ANTHROPIC], defaultId: string = ANTHROPIC.id) {
    for (const p of initial) this.register(p);
    if (!this.providers.has(defaultId)) throw new GovernanceError(`default provider not registered: ${defaultId}`);
    this.activeId = defaultId;
  }
  register(p: Provider): void { this.providers.set(p.id, p); }
  has(id: string): boolean { return this.providers.has(id); }
  get(id: string): Provider { const p = this.providers.get(id); if (!p) throw new GovernanceError(`unknown provider: ${id}`); return p; }
  list(): Provider[] { return [...this.providers.values()]; }
  active(): Provider { return this.get(this.activeId); }
  setActive(id: string): Provider { if (!this.providers.has(id)) throw new GovernanceError(`unknown provider: ${id}`); this.activeId = id; return this.active(); }
}
