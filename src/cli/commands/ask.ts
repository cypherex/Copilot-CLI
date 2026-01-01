// One-shot ask command with headless support

import chalk from 'chalk';
import ora from 'ora';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';

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
  const log = isPrintMode ? () => {} : console.log;
  const logError = isPrintMode ? console.error : (msg: string) => console.log(chalk.red(msg));

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

    if (!isPrintMode) {
      log(chalk.green('You:'), input);
      log();
    }

    // Capture output for JSON mode
    let capturedOutput = '';
    const originalLog = console.log;

    if (options.json) {
      console.log = (...args: unknown[]) => {
        const text = args.map(a => String(a)).join(' ');
        capturedOutput += text + '\n';
      };
    }

    await agent.chat(input);

    if (options.json) {
      console.log = originalLog;
      const result = {
        success: true,
        input,
        output: capturedOutput.trim(),
        provider: agent.getProviderName(),
        model: agent.getModelName(),
      };
      console.log(JSON.stringify(result, null, 2));
    }

    await agent.shutdown();
  } catch (error) {
    spinner?.fail('Failed');

    if (options.json) {
      console.log(JSON.stringify({
        success: false,
        input,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      logError(error instanceof Error ? error.message : String(error));
    }

    process.exit(1);
  }
}
