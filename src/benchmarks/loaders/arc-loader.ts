/**
 * ARC-AGI-2 dataset loader
 * Loads tasks from GitHub or local JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkConfig, BenchmarkLoader, ARCTask } from '../types.js';

export class ARCLoader implements BenchmarkLoader {
  private cacheDir: string;
  private githubUrl = 'https://github.com/fchollet/ARC-AGI/raw/master';

  constructor(cacheDir: string = path.join(process.cwd(), '.benchmark-cache')) {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  /**
   * Load all tasks for a dataset split
   */
  async load(config: BenchmarkConfig): Promise<ARCTask[]> {
    // For now, ARC-AGI-2 only supports arc-agi-2
    if (config.dataset !== 'arc-agi-2') {
      throw new Error(`Invalid ARC dataset: ${config.dataset}`);
    }

    console.log(`📚 Loading ARC-AGI-2 dataset`);

    // Try to load from local directory first
    const localPath = this.getLocalDataPath(config.dataset);
    if (fs.existsSync(localPath)) {
      console.log(`✓ Loading from local directory: ${localPath}`);
      return this.loadFromDirectory(localPath, config.instances);
    }

    // Provide instructions for downloading
    console.log(`\n⚠️ ARC-AGI-2 dataset not found at: ${localPath}`);
    console.log('\nTo use ARC-AGI-2, please:');
    console.log('1. Clone the ARC repository: git clone https://github.com/fchollet/ARC-AGI.git');
    console.log('2. Or download the dataset from: https://huggingface.co/datasets/arcprize/ARC-AGI-2');
    console.log('3. Place the task files in the data directory');
    console.log('\nDirectory structure expected:');
    console.log('  data/arc-agi-2/training/');
    console.log('  data/arc-agi-2/evaluation/');
    console.log('  data/arc-agi-2/test/');

    throw new Error(`ARC-AGI-2 dataset not found. Please download it first.`);
  }

  /**
   * Load a single task by ID
   */
  async loadSingle(id: string): Promise<ARCTask> {
    const taskPath = this.getTaskPath(id);

    if (!fs.existsSync(taskPath)) {
      throw new Error(`Task not found: ${id}`);
    }

    const content = fs.readFileSync(taskPath, 'utf-8');
    const task = JSON.parse(content);

    return {
      task_id: id,
      train: task.train,
      test: task.test,
    };
  }

  /**
   * Load all tasks from a directory
   */
  private async loadFromDirectory(dirPath: string, filter?: string | number): Promise<ARCTask[]> {
    const tasks: ARCTask[] = [];

    // Load from training, evaluation, and test directories if they exist
    const subdirs = ['training', 'evaluation', 'test'];

    for (const subdir of subdirs) {
      const subdirPath = path.join(dirPath, subdir);

      if (!fs.existsSync(subdirPath)) {
        console.log(`⚠️ Subdirectory not found: ${subdirPath}`);
        continue;
      }

      const files = fs.readdirSync(subdirPath).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const taskId = path.basename(file, '.json');
        const filePath = path.join(subdirPath, file);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const task = JSON.parse(content);

          tasks.push({
            task_id: taskId,
            train: task.train || [],
            test: task.test || [],
          });
        } catch (error) {
          console.warn(`⚠️ Failed to load task: ${taskId}`);
        }
      }
    }

    // Apply filter if specified
    if (filter) {
      return this.filterTasks(tasks, filter);
    }

    console.log(`✓ Loaded ${tasks.length} tasks`);
    return tasks;
  }

  /**
   * Filter tasks by range or ID
   */
  private filterTasks(tasks: ARCTask[], spec: string | number): ARCTask[] {
    if (typeof spec === 'number') {
      return [tasks[spec]];
    }

    // Parse range like "1-10"
    const rangeParts = String(spec).split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0]);
      const end = parseInt(rangeParts[1]);
      return tasks.slice(start, end + 1);
    }

    // Try to match by task_id
    return tasks.filter(t => t.task_id === spec);
  }

  /**
   * Get the path to a task JSON file
   */
  private getTaskPath(taskId: string): string {
    // Task ID format: e.g., "007bbfb7"
    // Path format: "data/arc-agi-2/training/007bbfb7.json"

    const localPath = this.getLocalDataPath('arc-agi-2');

    // Search in subdirectories
    for (const subdir of ['training', 'evaluation', 'test']) {
      const filePath = path.join(localPath, subdir, `${taskId}.json`);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    // Default to training directory
    return path.join(localPath, 'training', `${taskId}.json`);
  }

  /**
   * Get the local data directory path
   */
  private getLocalDataPath(dataset: string): string {
    // Check in common locations
    const locations = [
      path.join(process.cwd(), 'data', dataset),
      path.join(process.cwd(), 'datasets', dataset),
      path.join(this.cacheDir, dataset),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'arc-data', dataset),
    ];

    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return loc;
      }
    }

    // Return default (will be created if needed)
    return path.join(process.cwd(), 'data', dataset);
  }

  /**
   * Get task statistics
   */
  async getStats(dataset: string): Promise<{
    total: number;
    training: number;
    evaluation: number;
    test: number;
  }> {
    const localPath = this.getLocalDataPath(dataset);

    const stats = {
      total: 0,
      training: 0,
      evaluation: 0,
      test: 0,
    };

    const subdirs = { training: 'training', evaluation: 'evaluation', test: 'test' } as const;

    for (const [key, subdir] of Object.entries(subdirs)) {
      const subdirPath = path.join(localPath, subdir);
      if (fs.existsSync(subdirPath)) {
        const count = fs.readdirSync(subdirPath).filter(f => f.endsWith('.json')).length;
        stats[key as keyof typeof stats] = count;
        stats.total += count;
      }
    }

    return stats;
  }

  /**
   * List available ARC datasets
   */
  static listAvailableDatasets(): string[] {
    return ['arc-agi-2'];
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    if (fs.existsSync(this.cacheDir)) {
      fs.rmSync(this.cacheDir, { recursive: true });
      console.log(`✓ Cache cleared: ${this.cacheDir}`);
    }
  }
}
