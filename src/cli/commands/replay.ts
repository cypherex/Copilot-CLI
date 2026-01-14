import { readTraceEvents, summarizeTrace } from '../../trace/replay.js';
import { log } from '../../utils/index.js';

export async function replayCommand(
  tracePath: string,
  options: { json?: boolean }
): Promise<void> {
  const events = await readTraceEvents(tracePath);
  const summary = summarizeTrace(events);

  if (options.json) {
    log.info(JSON.stringify({ success: true, tracePath, ...summary }, null, 2));
    return;
  }

  if (summary.lastAssistantMessage) {
    process.stdout.write(summary.lastAssistantMessage.trimEnd() + '\n');
  }

  process.stdout.write(
    `\n[replay] assistant_responses=${summary.assistantResponses} tool_calls=${summary.toolCalls} tool_errors=${summary.toolErrors}\n`
  );
}
