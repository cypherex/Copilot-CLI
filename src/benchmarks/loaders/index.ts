/**
 * Benchmark loader registry
 * Factory for creating appropriate loaders for each benchmark
 */

import { BenchmarkConfig, BenchmarkLoader } from '../types.js';
import { SWEBenchLoader } from './swe-bench-loader.js';
import { ARCLoader } from './arc-loader.js';

export function createLoader(config: BenchmarkConfig): BenchmarkLoader {
  if (config.dataset === 'arc-agi-2') {
    return new ARCLoader();
  }

  // Default to SWE-bench for all SWE-bench variants
  return new SWEBenchLoader();
}

export { SWEBenchLoader, ARCLoader };
