# Runtime Pipeline (`ask`)

## End-to-end sequence

1. CLI parses args (see `src/cli/index.ts`).
2. `askCommand` creates `CopilotAgent` with runtime config:
   - `evalMode`, `allowedTools`, `seed`, `traceFile`.
3. `agent.initialize()` wires:
   - LLM client, conversation, tool registry, validators.
   - optional `TraceRecorder` (if `traceFile` set).
4. `agent.chat(input)` calls `AgenticLoop.processUserMessage()`.
5. Loop iterations:
   - run hooks: `user:prompt-submit`, `agent:iteration`, `assistant:response`, `tool:*`.
   - compute tool definitions (filtered by allowlist).
   - stream LLM output; parse tool calls.
   - execute tools via `ToolRegistry.execute()`.
6. Shutdown:
   - session end hook; recorder closes JSONL.

## Where to add/adjust behavior
- **Tool allowlisting**: `src/agent/tool-allowlist.ts` and `AgenticLoop.setAllowedTools()`
- **Eval-mode policy**: `src/tools/execute-bash.ts` (policy enforcement)
- **Observability**: implement a hook handler in `HookRegistry` and register it in `agent.initialize()`
- **Iteration budgets**: `AgenticLoop.maxIterations` + (lab) trace-based tool-call/time gating

## Known invariants
- Tool calls are always recorded (pre/post) when `--record` is enabled.
- Eval mode defaults to a safer allowlist (see `src/agent/index.ts`).
