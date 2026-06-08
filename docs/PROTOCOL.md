# Agent Protocol — canonical reasoning standard (framework §8)

Every agent follows this sequence; planning and validation may not be skipped:

LOAD_CONTEXT -> TASK_ANALYSIS -> PLAN_GENERATION -> ACTION_SELECTION -> EXECUTION -> VALIDATION -> FINAL_OUTPUT

Structurally enforced by the task lifecycle: a task cannot reach `completed` without passing
`validation`. All work is a task (§3.2); agents act only through governed tools (no task, no tool).
