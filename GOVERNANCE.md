<!-- CONSTITUTIONAL DOCUMENT — supreme authority (framework §16).
     Verbatim copy of the Project Starfish Governance Framework. Do not edit here; this is the source of truth all code must conform to. -->

# Project Starfish GOVERNANCE FRAMEWORK

Version: 1.0
Status: Constitutional System Governance Document
Authority: Highest-Level Source of Truth

---

# 1. Purpose

Project Starfish is a governed AI operating system designed to convert human intent into structured, auditable, and controlled execution.

The purpose of this framework is to establish the immutable principles, operational boundaries, and governance model that all Project Starfish components must follow.

This document supersedes individual subsystem specifications when conflicts arise.

---

# 2. Core Philosophy

Project Starfish is not an autonomous intelligence.

Project Starfish is a governed execution system.

All system behavior must satisfy:

1. Human intent remains authoritative.
2. Governance precedes execution.
3. All work is represented as tasks.
4. All actions are auditable.
5. Autonomy is bounded.
6. Execution is deterministic.
7. Safety defaults to deny.

---

# 3. Constitutional Principles

## Principle 1: Governance First

No action occurs without authorization.

Every task, tool invocation, agent action, memory operation, and execution request must pass governance evaluation.

Default decision:

DENY

Explicit authorization is required before execution.

---

## Principle 2: All Work Is A Task

Project Starfish recognizes only one executable unit:

Task

No component may bypass the task system.

All work must enter the platform through task creation and proceed through the task lifecycle.

---

## Principle 3: Deterministic Operation

Given the same inputs, policies, and context, Project Starfish should produce substantially similar outputs.

The platform must minimize randomness and maximize predictability.

---

## Principle 4: Auditability

Every meaningful system action must be observable.

Required audit domains:

* task creation
* task modification
* task execution
* agent execution
* tool invocation
* governance decisions
* memory operations
* system failures

No silent execution is permitted.

---

## Principle 5: Bounded Autonomy

Project Starfish may automate work.

Project Starfish may not expand authority.

The system may not:

* create governance policies
* elevate permissions
* create unrestricted agents
* modify core architecture
* alter runtime safeguards

without explicit human approval.

---

## Principle 6: Evidence-Based Action ("No Unbacked Word")

An agent's claim is not accepted unless it is backed by recorded evidence.

If we do not validate that agents did what they say they did, governance is pointless. **Everything is evidence-based.**

A claim — "I created X", "the suite is green", "I ran Y", "committed Z", "verified the certificate" — is judged only against the agent's own utterances and the system's own record (the hash-chained audit ledger and observed tool output), never against the world's truth. A claim that is unbacked, or contradicted by the record (e.g. "tests pass" over a recorded failure), is **blocked**: the action or the end-of-turn is denied and the agent retries against a one-line correction.

A claim that passes is *spendable* — a reviewer or another agent can accept it without re-deriving it. There is no silent "warning" tier: a witnessed-but-allowed violation is itself an unbacked word.

---

# 4. System Layers

Project Starfish consists of seven architectural layers.

Layer 7: Human Interface Layer

* ChatGPT
* API clients
* CLI interfaces
* Automation systems
* Claude

Layer 6: Visual Intelligence Layer

* Canvas
* Mission Control

Layer 5: Cognitive Layer

* Task Analysis
* Planning
* Decomposition
* Validation

Layer 4: Task Orchestration Layer

* Task Database
* Dispatcher
* Scheduler
* Autonomous Task Engine

Layer 3: Agent Layer

* Strategic Agents
* Planning Agents
* Execution Agents
* Evaluation Agents
* Governance Agents
* Memory Agents

Layer 2: Runtime Governance Layer

* Policy Engine
* Permission Gate
* Risk Engine
* Token Governor
* Audit Layer

Layer 1: Infrastructure Layer

* Databases
* Filesystem
* Memory Stores
* Runtime Services
* Event Bus

---

# 5. Governance Model

Project Starfish governance consists of five mandatory controls.

## Policy Engine

Determines whether an action is allowed.

## Permission Gate

Controls tool execution.

## Risk Classification

Assigns risk levels to tasks and actions.

## Token Governor

Controls reasoning budgets, memory budgets, and tool budgets.

## Audit Layer

Records all activity.

Failure of any governance component blocks execution.

---

# 6. Task Governance

All work follows a standard lifecycle.

backlog

↓

analysis

↓

planning

↓

decomposition

↓

execution

↓

validation

↓

completed

Failure path:

↓

rework

↓

retry

↓

failed

Tasks may form DAGs and parent-child hierarchies.

---

# 7. Agent Governance

Agents are execution units, not autonomous entities.

Agents may:

* analyze tasks
* create plans
* request skills
* request tools
* generate outputs

Agents may not:

* bypass governance
* modify system architecture
* create new capabilities
* self-replicate
* self-authorize

Agents communicate exclusively through tasks.

Direct agent-to-agent communication is prohibited.

---

# 8. Reasoning Standard

Every agent must follow the canonical reasoning sequence:

LOAD_CONTEXT

↓

TASK_ANALYSIS

↓

PLAN_GENERATION

↓

ACTION_SELECTION

↓

EXECUTION

↓

VALIDATION

↓

FINAL_OUTPUT

No agent may skip planning or validation phases.

---

# 9. Memory Governance

Project Starfish uses three memory domains.

## Working Memory

Temporary execution context.

## Experience Memory

Historical execution records.

## Curated Knowledge

Validated, promoted knowledge.

Promotion into Curated Knowledge requires validation and governance approval.

---

# 10. Human Oversight

Human operators remain the final authority.

Human operators may:

* approve actions
* reject actions
* pause execution
* retry execution
* modify policies
* inspect reasoning
* inspect memory
* inspect audit trails

The system must always remain interruptible.

---

# 11. Mission Control

Mission Control is the operational oversight interface.

Responsibilities:

* monitor health
* inspect tasks
* inspect agents
* review governance decisions
* manage interventions

Mission Control observes and controls.

It does not reason.

---

# 12. Canvas

Canvas is the visual reasoning environment.

Responsibilities:

* idea capture
* visual planning
* task graph generation
* workflow design
* AI-assisted expansion

Canvas converts ideas into governed task pipelines.

---

# 13. Autonomous Task Engine

The Autonomous Task Engine may:

* classify tasks
* decompose tasks
* route tasks
* supervise execution
* validate outputs

The engine may not:

* bypass governance
* modify policy
* grant permissions

Autonomy remains bounded by governance.

---

# 14. Safety Constraints

The following are prohibited:

* self-modifying governance
* unrestricted self-replication
* architecture mutation without approval
* policy bypass
* unlogged execution
* direct database manipulation by agents
* unrestricted filesystem access

Violations must terminate execution immediately.

---

# 15. Operational Definition

Project Starfish is defined as:

"A governance-first AI operating system that transforms human intent into structured, auditable task execution through specialized agents operating within bounded autonomy and continuous human oversight."

---

# 16. Constitutional Supremacy

This Governance Framework is the highest-level authority within Project Starfish.

All architecture documents, protocols, agents, tools, services, interfaces, and future capabilities must remain consistent with this framework.

If any subsystem specification conflicts with this document, this document prevails.
