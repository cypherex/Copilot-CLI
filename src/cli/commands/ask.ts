// One-shot ask command with headless support

import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';
import { log } from '../../utils/index.js';
import { AskRenderer } from '../../ui/ask-renderer.js';
import { LogManager } from '../../ui/log-manager.js';
import { ErrorHandler, handleError } from '../../utils/error-handler.js';
import { uiState } from '../../ui/ui-state.js';
import { join } from 'path';
import type { Task } from '../../memory/types.js';

interface AskOptions {
  directory: string;
  print?: boolean;
  json?: boolean;
  tools?: boolean;
  maxIterations?: number;
  outputFile?: string;
  file?: string;
  taskTree?: string;
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

function countReadyTasks(node: any): number {
  let count = 0;
  if (node.ready_to_spawn === true) {
    count = 1;
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countReadyTasks(child);
    }
  }
  return count;
}

export async function askCommand(
  question: string | undefined,
  options: AskOptions
): Promise<void> {
  const isPrintMode = options.print || options.json;
  const doLog = isPrintMode ? () => {} : log.info;
  const logError = isPrintMode ? (msg: string) => log.error(msg) : (msg: string) => log.error(msg);

  // Get question from args, file, or stdin
  let input = question || '';

  // Read from file if --file option provided
  if (options.file) {
    try {
      const fileContent = readFileSync(options.file, 'utf-8');
      // If question was also provided, prepend it to file content
      if (input) {
        input = `${input}\n\n${fileContent}`;
      } else {
        input = fileContent;
      }
    } catch (error) {
      logError(`Error: Failed to read file: ${options.file}`);
      logError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // Fall back to stdin if still no input
  if (!input) {
    input = await readStdin();
  }

  if (!input) {
    logError('Error: No question provided. Pass as argument, use --file, or pipe to stdin.');
    logError('Usage: copilot-cli ask "your question"');
    logError('   or: copilot-cli ask --file prompt.txt');
    logError('   or: echo "your question" | copilot-cli ask');
    process.exit(1);
  }

  // Store task tree path for later processing (after agent initialization)
  let taskTreeToLoad: any = null;
  if (options.taskTree) {
    try {
      const taskTreeContent = readFileSync(options.taskTree, 'utf-8');
      taskTreeToLoad = JSON.parse(taskTreeContent);

      const totalTasks = taskTreeToLoad.total_tasks || 0;
      const readyTasks = taskTreeToLoad.roots?.reduce((sum: number, root: any) => {
        return sum + countReadyTasks(root);
      }, 0) || 0;

      doLog(`Loaded task tree from ${options.taskTree}`);
      doLog(`Will continue breakdown from ${totalTasks} existing tasks (${readyTasks} ready)...`);
    } catch (error) {
      logError(`Error: Failed to read task tree file: ${options.taskTree}`);
      logError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  const config = await loadConfig();

  if (!config.auth.clientId && config.llm.provider === 'copilot') {
    logError('Error: No Azure Client ID configured.');
    logError('Set AZURE_CLIENT_ID environment variable or run:');
    logError('  copilot-cli config --set auth.clientId=YOUR_CLIENT_ID');
    process.exit(1);
  }

  const spinner = isPrintMode ? null : ora('Initializing...').start();

  // Create log manager if output file requested
  let logManager: LogManager | undefined;
  if (options.outputFile) {
    try {
      logManager = new LogManager({
        mainOutputPath: options.outputFile,
      });
    } catch (error) {
      logError(`Error: Failed to create output file: ${options.outputFile}`);
      logError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  try {
    const agent = new CopilotAgent(config.auth, config.llm, options.directory);

    // Set iteration limit (null = unlimited, which is default for ask)
    const maxIter = options.maxIterations !== undefined ? options.maxIterations : null;
    agent.setMaxIterations(maxIter);

    await agent.initialize();
    spinner?.stop();

    // Create renderer to show agent status, tool execution, and outputs
    const renderer = new AskRenderer({
      captureMode: options.json,              // Capture output in JSON mode
      verbose: true,
      logManager,                             // Use log manager for structured logging
      subAgentManager: agent.getSubAgentManager(), // For detailed subagent event capture
    });
    renderer.start();

    if (!isPrintMode) {
      log.info(chalk.green('You:') + ' ' + input);
      log.newline();
    }

    // If task tree was loaded, reconstruct tasks and continue breakdown
    if (taskTreeToLoad) {
      const memoryStore = agent.getMemoryStore();
      const spawnValidator = agent.getSpawnValidator();

      if (options.file) {
        uiState.addMessage({
          role: 'system',
          content: `Loaded prompt from file: ${options.file}`,
          timestamp: Date.now(),
        });
      }

      uiState.addMessage({
        role: 'system',
        content: `Loaded task tree from ${options.taskTree}\nContinuing breakdown before executing the prompt...`,
        timestamp: Date.now(),
      });

      const isTaskComplexity = (value: any): value is 'simple' | 'moderate' | 'complex' =>
        value === 'simple' || value === 'moderate' || value === 'complex';

      // Recursive function to reconstruct task hierarchy
      function reconstructTasks(node: any, parentId?: string): string {
        const estimatedComplexity = isTaskComplexity(node.complexity) ? node.complexity : undefined;
        const breakdownDepth = typeof node.depth === 'number' ? node.depth : undefined;
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const breakdownComplete =
          typeof node.ready_to_spawn === 'boolean' ? node.ready_to_spawn : hasChildren;

        // Create task in memory store
        const task = memoryStore.addTask({
          description: node.description,
          status: node.status || 'waiting',
          parentId,
          completionMessage: node.completionMessage,
          relatedFiles: [],
          priority: 'medium' as any,
          estimatedComplexity,
          breakdownDepth,
          breakdownComplete,
        });

        if (typeof node.id === 'string' && node.id.length > 0) {
          // Intentionally not restoring IDs; the MemoryStore generates new ones.
        }

        // Recursively create children
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            reconstructTasks(child, task.id);
          }
        }

        return task.id;
      }

      // Reconstruct all task trees from roots
      const rootTaskIds: string[] = [];
      if (taskTreeToLoad.roots && Array.isArray(taskTreeToLoad.roots)) {
        for (const root of taskTreeToLoad.roots) {
          const rootId = reconstructTasks(root);
          rootTaskIds.push(rootId);
        }
      }

      doLog(`Reconstructed ${taskTreeToLoad.total_tasks} tasks in memory`);
      doLog('Starting recursive breakdown continuation...\n');
      uiState.addMessage({
        role: 'system',
        content: `Reconstructed ${taskTreeToLoad.total_tasks} tasks in memory\nStarting recursive breakdown continuation...`,
        timestamp: Date.now(),
      });

      // Continue breakdown for complex leaf tasks only (prevents duplicating already-expanded parents).
      const allTasksBefore: Task[] = memoryStore.getTasks();
      const childCountByParent = new Map<string, number>();
      for (const t of allTasksBefore) {
        if (t.parentId) {
          childCountByParent.set(t.parentId, (childCountByParent.get(t.parentId) || 0) + 1);
        }
      }

      const complexLeafTasks = allTasksBefore.filter((t: Task) => {
        const hasChildren = childCountByParent.has(t.id);
        if (hasChildren) return false;
        if (t.status === 'completed' || t.status === 'abandoned') return false;
        // Continue breakdown if the leaf is complex OR complexity is unknown (common when loading older trees).
        return t.estimatedComplexity === 'complex' || t.estimatedComplexity === undefined;
      });

      if (complexLeafTasks.length === 0) {
        uiState.addMessage({
          role: 'system',
          content:
            'No complex leaf tasks found to continue breaking down. Proceeding to execute the prompt.',
          timestamp: Date.now(),
        });
      } else {
        uiState.addMessage({
          role: 'system',
          content: `Continuing breakdown for ${complexLeafTasks.length} complex/unknown leaf task(s) (will attach subtasks under existing tasks)...`,
          timestamp: Date.now(),
        });

        const offsetDepths = (node: any, offset: number): any => {
          const adjustedDepth =
            typeof node.breakdownDepth === 'number' ? node.breakdownDepth + offset : node.breakdownDepth;
          return {
            ...node,
            breakdownDepth: adjustedDepth,
            subtasks: Array.isArray(node.subtasks) ? node.subtasks.map((st: any) => offsetDepths(st, offset)) : node.subtasks,
          };
        };

        for (const parentTask of complexLeafTasks) {
          // Re-check children in case previous iterations added some
          const allTasksNow: Task[] = memoryStore.getTasks();
          const stillLeaf = !allTasksNow.some((t: Task) => t.parentId === parentTask.id);
          if (!stillLeaf) continue;

          uiState.addMessage({
            role: 'system',
            content: `Processing complex leaf: ${parentTask.description}`,
            timestamp: Date.now(),
          });

          const breakdownResult = await spawnValidator.recursiveBreakdownWithContext(
            parentTask.description,
            memoryStore,
            { maxDepth: 4, verbose: true }
          );

          const subtasks = breakdownResult.taskTree.subtasks || [];
          if (subtasks.length === 0) {
            uiState.addMessage({
              role: 'system',
              content: `No subtasks generated for: ${parentTask.description}`,
              timestamp: Date.now(),
            });
            continue;
          }

          const depthOffset = parentTask.breakdownDepth ?? 0;
          const createdTaskIds: string[] = [];
          for (const subtaskNode of subtasks) {
            const adjustedNode = offsetDepths(subtaskNode, depthOffset);
            const created = spawnValidator.createTaskHierarchy(adjustedNode, memoryStore, parentTask.id);
            createdTaskIds.push(...created.allTaskIds);
          }

          // Mark parent as a container now that it has subtasks.
          memoryStore.updateTask(parentTask.id, { breakdownComplete: breakdownResult.breakdownComplete });

          uiState.addMessage({
            role: 'system',
            content: `✓ Added ${createdTaskIds.length} task(s) under: ${parentTask.description}`,
            timestamp: Date.now(),
          });
        }
      }

      // Ensure get_next_tasks has a sane default for loaded tasks (no dependency graph in file).
      const allTasksAfter: Task[] = memoryStore.getTasks();
      for (const task of allTasksAfter) {
        const hasUnmetDependencies = (task.dependsOn || []).some((depId: string) => {
          const depTask = allTasksAfter.find((t: Task) => t.id === depId);
          return depTask && depTask.status !== 'completed';
        });
        if (task.status === 'waiting') {
          memoryStore.updateTask(task.id, { isDependencyLeaf: !hasUnmetDependencies });
        }
      }

      // Export updated task tree
      const fs = await import('fs');
      const allTasks = memoryStore.getTasks();

      function buildTaskNode(task: any): any {
        const children = allTasks.filter((t: any) => t.parentId === task.id);
        return {
          id: task.id,
          description: task.description,
          parent_id: task.parentId,
          depth: 0, // Will be calculated by export script
          complexity: task.estimatedComplexity,
          ready_to_spawn: task.status === 'waiting' && children.length === 0,
          status: task.status,
          completionMessage: task.completionMessage,
          children: children.map((c: any) => buildTaskNode(c)),
        };
      }

      const roots = allTasks.filter((t: any) => !t.parentId);
      const updatedTree = {
        total_tasks: allTasks.length,
        root_tasks: roots.length,
        roots: roots.map((r: any) => buildTaskNode(r)),
      };

      const exportPath = join(options.directory, 'task_hierarchy.json');
      fs.writeFileSync(exportPath, JSON.stringify(updatedTree, null, 2));
      doLog(`\n✓ Updated task tree exported to ${exportPath}`);
      doLog(`Total tasks: ${allTasks.length}`);

      uiState.addMessage({
        role: 'system',
        content: `✓ Updated task tree exported to ${exportPath}\nTotal tasks: ${allTasks.length}\nNow executing the prompt...`,
        timestamp: Date.now(),
      });
    }

    await agent.chat(input);

    // Wait for all background subagents to complete before shutdown
    const subAgentManager = agent.getSubAgentManager();
    const activeAgents = subAgentManager.listActive();
    if (activeAgents.length > 0) {
      if (!isPrintMode) {
        log.info(`\n⏳ Waiting for ${activeAgents.length} background subagent(s) to complete...`);
      }
      await subAgentManager.waitForAll();
      if (!isPrintMode) {
        log.info('✅ All background subagents completed\n');
      }
    }

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
    uiState.addMessage({ role: 'system', content: `[TRACE] Agent shutdown complete.`, timestamp: Date.now() });

    // Close all log streams
    if (logManager) {
      await logManager.closeAll();
      uiState.addMessage({ role: 'system', content: `[TRACE] Log manager closed.`, timestamp: Date.now() });
    }
    
    // Add final completion message for visibility in output file
    uiState.addMessage({ 
      role: 'system', 
      content: '\n✅ PROCESS COMPLETED SUCCESSFULLY. EXITING.', 
      timestamp: Date.now() 
    });
    
    uiState.addMessage({ role: 'system', content: `[TRACE] askCommand finishing normally.`, timestamp: Date.now() });

    // STOP RENDERER AT THE VERY END
    renderer.stop();
    
    // FINAL DIRECT WRITE
    process.stdout.write('[TRACE] ABSOLUTE END OF askCommand REACHED\n');
  } catch (error: any) {
    spinner?.fail('Failed');

    const userFriendly = ErrorHandler.getUserFriendlyMessage(error);
    const stack = ErrorHandler.getStackTrace(error);

    // Add crash message to UI state for visibility in output file
    uiState.addMessage({
      role: 'system',
      content: `\n🛑 FATAL ERROR: ${userFriendly}${stack ? `\n\nStack Trace:\n${stack}` : ''}`,
      timestamp: Date.now(),
    });

    // Close log streams on error
    if (logManager) {
      await logManager.closeAll().catch(() => {
        // Ignore errors during cleanup
      });
    }

    // Use ErrorHandler with stack logging
    handleError(error, {
      context: 'askCommand',
      includeStack: !isPrintMode, // Show stack in interactive mode
      silent: options.json, // Don't log to stderr in JSON mode
    });

    if (options.json) {
      log.info(JSON.stringify({
        success: false,
        input,
        error: ErrorHandler.getUserFriendlyMessage(error),
        stack: process.env.NODE_ENV === 'development' || process.env.DEBUG
          ? ErrorHandler.getStackTrace(error)
          : undefined,
      }, null, 2));
    }

    process.exit(1);
  }
}
