import path from 'path';
import os from 'os';

/**
 * Base directory for Copilot CLI state on disk.
 *
 * Override with `COPILOT_CLI_HOME` (useful for sandboxes/tests/portable installs).
 * Default: `~/.copilot-cli`
 */
export function getCopilotCliHomeDir(): string {
  const override = process.env.COPILOT_CLI_HOME?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.copilot-cli');
}

