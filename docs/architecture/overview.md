# Architecture Overview

## High-level flow

```
CLI (chat/ask/benchmark)
  → Agent (CopilotAgent)
    → AgenticLoop (iteration, tool routing, validators)
      → ToolRegistry (tool execution)
      → HookRegistry (session/tool/assistant/user events)
      → TraceRecorder (optional JSONL event stream)
```

## Key subsystems

### Agent runtime
- Entry: `src/cli/index.ts` and `src/cli/commands/*`
- Agent wiring: `src/agent/index.ts`
- Main loop: `src/agent/loop.ts`

### Tools
- Registry + definitions: `src/tools/*`
- Safety policy hooks (eval mode): `src/tools/execute-bash.ts` + `src/tools/types.ts`

### Hooks
- Hook types + execution: `src/hooks/*`
- Used for tracing/observability and pre/post tool execution interception.

### Tracing
- Event schema: `src/trace/types.ts`
- Recorder: `src/trace/recorder.ts` (writes JSONL)
- Replay/summarize: `src/trace/replay.ts`

## Contracts the lab depends on
- `copilot-cli ask ... --record <path>` produces JSONL events with stable `type` names.
- `--eval` + `--allowed-tools` provide a constrained mode for safe, reproducible evaluation runs.
- Tool names/args/results remain stable (or evolve with backward compatibility).
