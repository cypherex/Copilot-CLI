# Tooling Contracts

## Tool naming
- Tool names are part of a public-ish interface consumed by `copilot-lab`.
- Prefer additive changes; avoid renames.

## Tool execution
- The agent executes tools through the registry; tools return:
  - `success: boolean`
  - `output?: string`
  - `error?: string`

## Eval mode policy
- In eval mode, the runtime injects a `ToolPolicy` (see `src/tools/types.ts`).
- Tools must enforce policy locally (e.g. `execute_bash` blocks obvious network/package install patterns).

## Trace expectations
When `--record` is enabled, the following events are emitted at minimum:
- `trace_header` (argv, git sha, run config)
- `session_start` / `session_end`
- `user_prompt_submit`
- `agent_iteration`
- `assistant_response`
- `tool_pre_execute` / `tool_post_execute`

The lab uses these for:
- hard gates (tool errors, timeouts, verify steps)
- soft metrics (tool-call counts, iteration counts)
- qualitative judging evidence (diff + verify output + trace summary)
