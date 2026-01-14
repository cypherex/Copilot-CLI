/**
 * SWE-bench dataset loader
 * Loads instances from HuggingFace datasets or local JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkConfig, BenchmarkLoader, SWEBenchInstance } from '../types.js';

export class SWEBenchLoader implements BenchmarkLoader {
  private cacheDir: string;

  constructor(cacheDir: string = path.join(process.cwd(), '.benchmark-cache')) {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  /**
   * Map dataset name to HuggingFace dataset ID
   */
  private getHuggingFaceDatasetId(dataset: string): string {
    const mappings: Record<string, string> = {
      'swe-bench': 'SWE-bench/SWE-bench',
      'swe-bench-lite': 'SWE-bench/SWE-bench_Lite',
      'swe-bench-verified': 'SWE-bench/SWE-bench_Verified',
    };

    return mappings[dataset] || mappings['swe-bench-lite'];
  }

  /**
   * Load all instances for a dataset
   */
  async load(config: BenchmarkConfig): Promise<SWEBenchInstance[]> {
    console.log(`📚 Loading SWE-bench dataset: ${config.dataset}`);

    // Try to load from local cache first
    const cachedPath = this.getCachePath(config.dataset);
    if (fs.existsSync(cachedPath)) {
      console.log(`✓ Loading from cache: ${cachedPath}`);
      const content = fs.readFileSync(cachedPath, 'utf-8');

      // Handle JSONL format (one JSON per line)
      let instances: SWEBenchInstance[] = [];
      if (cachedPath.endsWith('.jsonl')) {
        instances = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line) as SWEBenchInstance);
      } else {
        // Handle JSON array format
        instances = JSON.parse(content) as SWEBenchInstance[];
      }

      // Filter by instances if specified
      if (config.instances) {
        instances = this.filterInstances(instances, config.instances);
      }

      return instances;
    }

    // If cache doesn't exist, provide instructions
    console.log(`\n⚠️ Dataset cache not found at: ${cachedPath}`);
    console.log('\nTo use SWE-bench, please:');
    console.log('1. Download from HuggingFace: https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified');
    console.log('2. Or use the Python script: `huggingface-hub` to download');
    console.log('3. Place the JSON file in the cache directory');
    console.log('\nExample command:');
    console.log(`  python -m huggingface_hub.cli download SWE-bench/SWE-bench_Verified --repo-type dataset --local-dir ${this.cacheDir}`);

    throw new Error(`Dataset not found: ${config.dataset}`);
  }

  /**
   * Load a single instance by ID
   */
  async loadSingle(id: string): Promise<SWEBenchInstance> {
    // This would require the full dataset to be loaded first
    // For now, return a placeholder
    throw new Error('Single instance loading not yet implemented');
  }

  /**
   * Filter instances by range or ID
   */
  private filterInstances(instances: SWEBenchInstance[], spec: string | number): SWEBenchInstance[] {
    if (typeof spec === 'number') {
      // Single index
      return [instances[spec]];
    }

    const specStr = String(spec).trim();

    // Check if it's a numeric range like "1-10"
    if (specStr.includes('-')) {
      const parts = specStr.split('-');
      if (parts.length === 2 && parts[0].match(/^\d+$/) && parts[1].match(/^\d+$/)) {
        const start = parseInt(parts[0]);
        const end = parseInt(parts[1]);
        return instances.slice(start - 1, end); // Convert to 0-based indexing
      }
    }

    // Check if it's a single number (convert to 0-based index)
    if (specStr.match(/^\d+$/)) {
      const index = parseInt(specStr) - 1; // Convert to 0-based
      if (index >= 0 && index < instances.length) {
        return [instances[index]];
      }
      return [];
    }

    // Try to match by instance_id
    const matching = instances.filter(i => i.instance_id === specStr);
    if (matching.length > 0) {
      return matching;
    }

    // Try partial match
    return instances.filter(i => i.instance_id.includes(specStr));
  }

  /**
   * Get cache file path for dataset
   */
  private getCachePath(dataset: string): string {
    const filename = dataset === 'swe-bench' ? 'data.jsonl' : `${dataset}.jsonl`;
    return path.join(this.cacheDir, filename);
  }

  /**
   * Download dataset from HuggingFace (requires huggingface_hub)
   */
  async downloadFromHuggingFace(dataset: string): Promise<void> {
    const datasetId = this.getHuggingFaceDatasetId(dataset);
    console.log(`⬇️ Downloading ${datasetId}...`);

    // This would require Python/huggingface_hub
    throw new Error(
      `Automatic download not implemented. Please download manually from: https://huggingface.co/datasets/${datasetId}`
    );
  }

  /**
   * Load from local JSON file
   */
  async loadFromFile(filePath: string): Promise<SWEBenchInstance[]> {
    console.log(`📂 Loading from file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Handle JSONL format (one JSON per line)
    if (filePath.endsWith('.jsonl')) {
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as SWEBenchInstance);
    }

    // Handle JSON array format
    try {
      return JSON.parse(content) as SWEBenchInstance[];
    } catch {
      throw new Error(`Invalid JSON format in file: ${filePath}`);
    }
  }

  /**
   * Save instances to cache for reuse
   */
  async saveToCache(dataset: string, instances: SWEBenchInstance[]): Promise<void> {
    const cachePath = this.getCachePath(dataset);
    const jsonl = instances.map(i => JSON.stringify(i)).join('\n');
    fs.writeFileSync(cachePath, jsonl, 'utf-8');
    console.log(`✓ Cached ${instances.length} instances at: ${cachePath}`);
  }

  /**
   * Get dataset statistics
   */
  async getStats(dataset: string): Promise<{ total: number; repos: string[] }> {
    const instances = await this.load({ dataset } as BenchmarkConfig);
    const repos = [...new Set(instances.map(i => i.repo))];

    return {
      total: instances.length,
      repos: repos.sort(),
    };
  }

  /**
   * List available datasets
   */
  static listAvailableDatasets(): string[] {
    return ['swe-bench', 'swe-bench-lite', 'swe-bench-verified'];
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
