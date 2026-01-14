# Evaluation Mode

## Purpose
Evaluation runs should be:
- safer (reduced side effects)
- more reproducible
- easy to score from traces + external verification commands

## Mechanisms
- `--eval` enables safer defaults (see `src/agent/index.ts`):
  - restricted tool allowlist
  - tool policy injection (`ToolPolicy`)
- `--allowed-tools a,b,c` overrides the allowlist (lab controls this for task-specific runs).
- `--record <path>` writes a JSONL trace consumed by `copilot-lab`.

## What the lab scores
- Hard gates:
  - verification commands (tests/lint/typecheck) succeed
  - rubric criteria meet minimum scores (if specified)
  - (optional) no tool errors in trace
- Soft metrics:
  - rubric scores (readability, minimality, etc.)
  - runtime, tool calls, error count

## Determinism
- `--seed` is recorded in the trace and may be used by future providers/runners for best-effort determinism.
