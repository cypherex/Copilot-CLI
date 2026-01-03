// One-shot ask command with headless support

import chalk from 'chalk';
import ora from 'ora';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';
import { log } from '../../utils/index.js';
import { AskRenderer } from '../../ui/ask-renderer.js';

interface AskOptions {
  directory: string;
  print?: boolean;
  json?: boolean;
  tools?: boolean;
  maxIterations?: number;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if stdin is a TTY (interactive) - if so, no piped input
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    process.stdin.on('error', reject);

    // Timeout after 100ms if no data (not piped)
    setTimeout(() => {
      if (!data) {
        resolve('');
      }
    }, 100);
  });
}

export async function askCommand(
  question: string | undefined,
  options: AskOptions
): Promise<void> {
  const isPrintMode = options.print || options.json;
  const doLog = isPrintMode ? () => {} : log.info;
  const logError = isPrintMode ? (msg: string) => log.error(msg) : (msg: string) => log.error(msg);

  // Get question from args or stdin
  let input = question || '';

  if (!input) {
    input = await readStdin();
  }

  if (!input) {
    logError('Error: No question provided. Pass as argument or pipe to stdin.');
    logError('Usage: copilot-cli ask "your question"');
    logError('   or: echo "your question" | copilot-cli ask');
    process.exit(1);
  }

  const config = await loadConfig();

  if (!config.auth.clientId && config.llm.provider === 'copilot') {
    logError('Error: No Azure Client ID configured.');
    logError('Set AZURE_CLIENT_ID environment variable or run:');
    logError('  copilot-cli config --set auth.clientId=YOUR_CLIENT_ID');
    process.exit(1);
  }

  const spinner = isPrintMode ? null : ora('Initializing...').start();

  try {
    const agent = new CopilotAgent(config.auth, config.llm, options.directory);

    // Set iteration limit (null = unlimited, which is default for ask)
    const maxIter = options.maxIterations !== undefined ? options.maxIterations : null;
    agent.setMaxIterations(maxIter);

    await agent.initialize();
    spinner?.stop();

    // Create renderer to show agent status, tool execution, and outputs
    const renderer = new AskRenderer({
      captureMode: options.json, // Capture output in JSON mode
      verbose: true,
    });
    renderer.start();

    if (!isPrintMode) {
      log.info(chalk.green('You:') + ' ' + input);
      log.newline();
    }

    await agent.chat(input);

    // Stop renderer
    renderer.stop();

    if (options.json) {
      const result = {
        success: true,
        input,
        output: renderer.getCapturedOutput().trim(),
        provider: agent.getProviderName(),
        model: agent.getModelName(),
      };
      log.info(JSON.stringify(result, null, 2));
    }

    await agent.shutdown();
  } catch (error) {
    spinner?.fail('Failed');

    if (options.json) {
      log.info(JSON.stringify({
        success: false,
        input,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      log.error(error instanceof Error ? error.message : String(error));
    }

    process.exit(1);
  }
}
