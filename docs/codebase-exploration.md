# Codebase Exploration (Explorer Subagent)

This repo includes a dedicated **read-only** exploration workflow designed for existing/legacy projects where the agent must discover context before planning changes.

## What It Is

- A specialized subagent role: `explorer`
- A dedicated tool for the orchestrator: `explore_codebase`
- A strict output contract (JSON) so the main agent can reliably consume results

## When To Use

- The user request is underspecified for an existing project (unclear goal/requirements).
- The main agent needs to quickly locate *where* a feature lives, identify entrypoints, or find relevant config.
- Mid-task "go find X in the repo" without polluting the main context.

## How It Works

1. Orchestrator calls `explore_codebase({ question, ... })`
2. Tool spawns an `explorer` subagent with a **tool allowlist**:
   - `read_file`
   - `grep_repo`
3. The subagent searches and reads minimally, then returns a single JSON object.

## Input Contract (Tool)

`explore_codebase` parameters:

- `question` (string, required): What to find/understand
- `directory` (string, optional): Working directory for exploration
- `hints` (string[], optional): Constraints to guide exploration
- `files` (string[], optional): Known-relevant files to prioritize
- `depth` ("shallow" | "normal" | "deep", optional): Controls iteration budget
- `repair` (boolean, optional): If true, attempt a one-shot JSON repair pass (default: true)
- `timeout_ms` (number, optional): Overall timeout in ms; `0` disables (default: 0)

## Output Contract (Subagent)

The `explorer` role MUST output **one valid JSON object and nothing else** (no markdown/code fences).

Schema (high-level):

- `question`: the prompt the explorer answered
- `inferredUserGoal`: a single best guess goal, or `null` if ambiguous
- `confidence`: number 0.0–1.0
- `repoMap`: entrypoints/key dirs/configs/commands
- `findings`: up to ~5 findings with evidence
- `missingInfoQuestions`: questions to resolve ambiguity
- `recommendedNextAction`: `"ask_confirmation" | "ask_clarifying_questions" | "ready_to_plan"`

## Recommended Orchestrator Flow

- If `recommendedNextAction === "ask_confirmation"`:
  - Present the inferred goal + proposed plan
  - Ask the user to confirm before any edits
- If `recommendedNextAction === "ask_clarifying_questions"`:
  - Ask only the minimum questions necessary
- If `recommendedNextAction === "ready_to_plan"`:
  - Proceed with normal planning/task breakdown
