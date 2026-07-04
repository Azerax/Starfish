# Starfish → Compliance Control Mapping

Informational mapping from Starfish's built controls to common frameworks. Not a certification and not
legal advice; intended to help an adopting org evidence relevant controls. (Project Starfish is a fork of
Munder Difflin.)

## SOC 2 (Trust Services Criteria)
| TSC | Starfish control | Where |
| --- | --- | --- |
| CC6.1 Logical access | Deny-by-default PDP; per-agent/skill boundaries; secret-path deny at the PEP | boundary.ts, peps.ts |
| CC6.6 External threats | Loopback-only sidecar; Host-header + bearer-token + wire handshake; internal-egress guard | serve.ts, netguard.ts |
| CC6.8 Unauthorized change | Hash-chained audit; self-integrity manifest; verify-before-exec launcher | audit.ts, selfintegrity.ts |
| CC7.2 Monitoring | SecurityMonitor reconcile vs deterministic counters; live SSE stream | monitor.ts, serve.ts |
| CC7.3 Incident response | Fail-closed safe mode on tamper/torn/truncated audit | boot.ts, audit.ts |
| CC8.1 Change management | Frozen public surface + wire version as the semver gate; CI gate on every push | api-surface tests, ci.yml |

## ISO/IEC 27001:2022 (Annex A)
| Control | Starfish control | Where |
| --- | --- | --- |
| A.5.15 Access control | Deny-by-default policy engine; proposer≠approver; operator principal sets | policy.ts, broker.ts |
| A.8.2 Privileged access | Operator-only approvals; per-root operator sets in multi-tenant sidecar | broker.ts, serve.ts |
| A.8.15 Logging | Append-only hash-chained, secret-redacted audit; rotation with chained segment roots | audit.ts |
| A.8.16 Monitoring | Reconciled security monitor; anomaly escalation | monitor.ts |
| A.8.24 Cryptography | SHA-256 chain; operator-signed self-manifest (Ed25519) | hash.ts, selfintegrity.ts |
| A.8.28 Secure coding | Dependency-direction lint; secret-scan; adapter conformance | scripts/, provider tests |

## EU AI Act (high-level, provider/deployer of a governed agent system)
| Article theme | Starfish control | Where |
| --- | --- | --- |
| Art. 12 Record-keeping / logging | Tamper-evident audit with truthful outcomes (failures not logged as allow) | audit.ts, runner.ts, peps.ts |
| Art. 14 Human oversight | Every "ask" parks for human go/no-go; proposer≠approver; forced-stop Ready Room | broker.ts, desktop UI |
| Art. 15 Accuracy/robustness/cybersecurity | Fail-closed on integrity failure; egress + catastrophic-shell containment; conservative cost accounting | boot.ts, netguard.ts, handler.ts, runner.ts |
| Art. 9 Risk management | Documented threat classes + mitigations; risk register + heatmap | docs/THREAT_CLASSES_AND_MITIGATIONS.md, docs/EMBED_RISK_* |

> These mappings describe capabilities Starfish provides. Certification requires an organizational program
> and an independent assessor; a control being *available* is not the same as it being *operated*.
