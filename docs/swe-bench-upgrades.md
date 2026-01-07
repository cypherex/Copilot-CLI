# SWE-bench Upgrade Task List

This is an implementation-oriented backlog for making the CLI agent highly competitive on SWE-bench-style bugfix tasks.

## High-impact items

1. **First-class repro runner**
   - Add a dedicated tool to run and record a minimal repro command (usually a targeted test).
   - Persist the last failing repro output/exit code in working state so later steps can reference “ground truth”.

2. **Enforced verification policy**
   - Add a tool to run verification commands (targeted tests → broader checks).
   - Record the last verification run in working state.
   - Gate task completion so tasks can only be marked `completed` after a passing verification run that occurred after the task entered `pending_verification`.

3. **Unified diff patching**
   - Add a diff-native patch tool (unified diff) that can apply multi-hunk edits more reliably than search/replace.
   - Preserve line endings and detect/reject ambiguous hunks.

## Optional (but synergistic)

4. **ToT (“Tree of Thoughts”) thinking tool**
   - Add a tool that spawns several parallel subagents (“branches”) to generate competing hypotheses/patch plans.
   - Return ranked, actionable suggestions into the chat (not an enforced decision), so the agent/subagent can choose what to try next.
