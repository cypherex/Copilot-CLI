# Debugging & Theory Testing (Task System)

This repo supports a hypothesis-driven debugging workflow using the task system, so the agent can iteratively test theories and keep a reliable trail of what was tried.

## Key Idea

Treat debugging as a sequence of small "experiments":

1. Reproduce the issue reliably
2. Form a single hypothesis
3. Run a targeted experiment
4. Record the outcome (supports/refutes/inconclusive)
5. Repeat until root cause is found
6. Implement fix and verify

## Tools

### debug_scaffold

Creates a small task tree to guide the loop:
- Repro
- Explore (often via `explore_codebase`)
- Hypothesis/Experiment pairs
- Fix
- Verify
- Regressions (optional)

### record_experiment_result

Appends a structured log entry to a task's `completionMessage`:
- hypothesis + prediction
- exact steps/commands run
- observed result
- conclusion
- next step

Optionally updates the task's status (e.g., `completed`, `blocked`, `waiting`) and can create a follow-up task.

## Recommended Workflow

1. Call `debug_scaffold({ bug: "...", experiments: 1 })`
2. Work the `Repro:` task until you can consistently reproduce and capture evidence
3. For each experiment:
   - Run the command(s)
   - Call `record_experiment_result({ ... })` to log what happened
4. Once the fix is implemented:
   - Set the fix task to `pending_verification`
   - Run verification
   - Then mark it `completed`
