// Tier-3 governance: registration-time allowlisting for Foundry's SERVICE-EXECUTED built-in tools
// (Code Interpreter, File Search, Web Search, Azure AI Search, native Azure Functions, Computer Use,
// Browser Automation, Image Generation, Fabric, SharePoint). See docs/design/azure.md Sec 2 for why this
// tier is registration-time + audit, not a synchronous gate: Foundry never asks anyone before running
// these, so there is no call to intercept. This module is honest about that -- it is a config check that
// runs BEFORE an agent is deployed/updated, not a runtime decision, and nothing here should ever be
// described as "gating" a built-in tool call, because it doesn't and structurally can't.
//
// NOT YET WIRED into a real deployment pipeline -- this is the policy engine + its own test cases, not a
// CI/CD hook. Wiring it into "whatever process actually creates/updates a Foundry agent's tool list" is
// an open integration point, since that process is customer-specific (IaC, a portal click, a deploy
// script) and this repo doesn't know which one a given customer uses.

export type BuiltInTool =
  | 'code_interpreter' | 'custom_code_interpreter' | 'file_search' | 'web_search'
  | 'azure_ai_search' | 'azure_functions' | 'image_generation' | 'browser_automation'
  | 'computer_use' | 'fabric' | 'sharepoint';

export const ALL_BUILT_IN_TOOLS: readonly BuiltInTool[] = [
  'code_interpreter', 'custom_code_interpreter', 'file_search', 'web_search',
  'azure_ai_search', 'azure_functions', 'image_generation', 'browser_automation',
  'computer_use', 'fabric', 'sharepoint',
];

/** A named combination that is disallowed together, regardless of which agent requests it. The
 *  motivating example from docs/design/azure.md Sec 2: Code Interpreter (arbitrary code execution) +
 *  Web Search (live external content) together gives an agent a code-execution surface reachable from
 *  untrusted web content in one hop -- allowed individually, disallowed combined, by default. */
export interface ForbiddenCombo { tools: readonly BuiltInTool[]; reason: string }

export const DEFAULT_FORBIDDEN_COMBOS: readonly ForbiddenCombo[] = [
  {
    tools: ['code_interpreter', 'web_search'],
    reason: 'code execution + live external content in one agent is a one-hop injection-to-RCE surface',
  },
  {
    tools: ['custom_code_interpreter', 'web_search'],
    reason: 'same rationale as code_interpreter + web_search; custom_code_interpreter is still arbitrary execution',
  },
  {
    tools: ['browser_automation', 'computer_use'],
    reason: 'both grant broad host/UI-level action surfaces; stacking them multiplies blast radius with no corresponding benefit -- an agent that can drive a browser rarely also needs raw computer-use control',
  },
];

export interface AgentToolPolicy {
  /** Tools this agent may register at all, independent of combos. Empty/omitted = deny all built-ins
   *  (the honest deny-by-default default -- an agent gets NOTHING from this tier until explicitly
   *  allowlisted, matching the rest of the product's posture). */
  allowed?: readonly BuiltInTool[];
  /** Combos to check IN ADDITION TO the defaults above. Does not replace DEFAULT_FORBIDDEN_COMBOS --
   *  narrowing further is fine, loosening the defaults requires an explicit override (see
   *  `allowOverridingDefaults`) so a config typo can't silently reopen a closed combo. */
  additionalForbiddenCombos?: readonly ForbiddenCombo[];
  /** Explicit, audited opt-out of specific default combos. Requires a reason string per entry --
   *  unreasoned overrides are rejected at policy-load time, not silently accepted. */
  allowOverridingDefaults?: ReadonlyArray<{ combo: readonly BuiltInTool[]; reason: string }>;
}

export interface RegistrationCheckResult {
  allow: boolean;
  reason: string;
  /** Every rule that was actually evaluated, allowed or not -- an audit trail for the registration
   *  decision itself, since this tier's whole reason for existing is that runtime calls can't be
   *  audited the normal way. */
  evaluatedRules: string[];
}

export function checkToolRegistration(
  agentId: string,
  requestedTools: readonly BuiltInTool[],
  policy: AgentToolPolicy,
): RegistrationCheckResult {
  const evaluatedRules: string[] = [];
  const allowed = new Set(policy.allowed ?? []);
  const overrides = new Map((policy.allowOverridingDefaults ?? []).map((o) => [comboKey(o.combo), o.reason]));

  for (const tool of requestedTools) {
    evaluatedRules.push(`allowlist-check: ${tool}`);
    if (!allowed.has(tool)) {
      return {
        allow: false,
        reason: `agent '${agentId}' requested built-in tool '${tool}' which is not in its allowlist (deny-by-default: nothing is allowed unless explicitly listed)`,
        evaluatedRules,
      };
    }
  }

  const combosToCheck = [...DEFAULT_FORBIDDEN_COMBOS, ...(policy.additionalForbiddenCombos ?? [])];
  for (const combo of combosToCheck) {
    evaluatedRules.push(`combo-check: [${combo.tools.join(', ')}]`);
    const allPresent = combo.tools.every((t) => requestedTools.includes(t));
    if (!allPresent) continue;
    const key = comboKey(combo.tools);
    const overrideReason = overrides.get(key);
    if (overrideReason) {
      evaluatedRules.push(`combo-check: [${combo.tools.join(', ')}] -- explicitly overridden: ${overrideReason}`);
      continue;
    }
    return {
      allow: false,
      reason: `agent '${agentId}' requests forbidden combo [${combo.tools.join(' + ')}]: ${combo.reason}`,
      evaluatedRules,
    };
  }

  return { allow: true, reason: 'all requested built-in tools individually allowlisted and no forbidden combo present', evaluatedRules };
}

function comboKey(tools: readonly BuiltInTool[]): string {
  return [...tools].sort().join('+');
}
