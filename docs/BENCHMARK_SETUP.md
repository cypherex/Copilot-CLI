# Benchmark Setup Guide

This document provides setup instructions for running the Copilot CLI agent on SWE-bench and ARC-AGI-2 benchmarks.

## Overview

The benchmark infrastructure supports:

1. **SWE-bench** - Real-world GitHub issue resolution tasks
   - Variants: Full (2,294 instances), Lite (300 instances), Verified (500 instances)
   - Evaluation: Pass/fail based on test suite execution
   - Environment: Docker containers with isolated repo clones

2. **ARC-AGI-2** - Pattern recognition and grid transformation tasks
   - Tasks: 120 evaluation tasks
   - Evaluation: Exact match on all cells (Pass@1, Pass@2)
   - Environment: Python runtime for code execution

## Quick Start

### 1. Prerequisites

- Docker installed and running
- Python 3.11+
- Git
- Node.js 18+ (for CLI)

### 2. Build Docker Images

```bash
# Build SWE-bench environment
docker build -t copilot-cli-swe-bench \
  -f docker/swe-bench/Dockerfile .

# Build ARC-AGI-2 environment
docker build -t copilot-cli-arc \
  -f docker/arc/Dockerfile .
```

### 3. Set Up Datasets

#### SWE-bench

The SWE-bench dataset needs to be downloaded manually from HuggingFace:

```bash
# Install huggingface-hub if not already installed
pip install huggingface-hub

# Download SWE-bench-lite (recommended for testing)
huggingface-hub download SWE-bench/SWE-bench_Lite \
  --repo-type dataset \
  --local-dir ./data/swe-bench-lite

# Or download Verified variant
huggingface-hub download SWE-bench/SWE-bench_Verified \
  --repo-type dataset \
  --local-dir ./data/swe-bench-verified
```

#### ARC-AGI-2

Download ARC-AGI-2 from GitHub or HuggingFace:

```bash
# Clone the ARC-AGI repository
git clone https://github.com/fchollet/ARC-AGI.git ./data/arc-agi

# Or download from HuggingFace
huggingface-hub download arcprize/ARC-AGI-2 \
  --repo-type dataset \
  --local-dir ./data/arc-agi-2
```

### 4. Run Benchmarks

```bash
# Test a single SWE-bench instance
npm run build  # Build the CLI
node lib/index.js benchmark run --dataset swe-bench-lite --instances 0-5

# Run on ARC-AGI-2
node lib/index.js benchmark run --dataset arc-agi-2 --instances 0-10

# Save results to file
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --output results/swe-bench-lite.json
```

## Architecture

### Directory Structure

```
src/benchmarks/
├── types.ts                    # Core type definitions
├── docker/
│   └── manager.ts             # Docker orchestration utilities
├── loaders/
│   ├── index.ts               # Loader factory
│   ├── swe-bench-loader.ts   # SWE-bench dataset loader
│   └── arc-loader.ts          # ARC-AGI-2 dataset loader
├── harness/
│   ├── runner.ts              # Main execution orchestrator (coming soon)
│   └── evaluator.ts           # Results evaluation (coming soon)
└── reports/
    └── formatter.ts           # Results export (JSON/CSV/TXT)

docker/
├── swe-bench/
│   └── Dockerfile            # SWE-bench evaluation environment
└── arc/
    └── Dockerfile            # ARC-AGI-2 evaluation environment
```

### Component Status

✅ **Implemented**:
- Core benchmark types and interfaces
- CLI command structure
- Results export framework (JSON/CSV/TXT)
- Docker orchestration utilities
- Dataset loaders for both benchmarks
- Docker images for both benchmarks

⏳ **Coming Soon**:
- Benchmark harness and runner
- Integration with agent loop
- Full evaluation pipeline
- Parallel execution support
- Checkpoint/resume functionality

## Configuration

### Environment Variables

- `DOCKER_SOCKET_PATH` - Override default Docker socket path
- `BENCHMARK_TIMEOUT` - Default timeout per task (seconds)
- `BENCHMARK_CACHE_DIR` - Cache directory for datasets

### Config File

Create `.benchmark-config.json`:

```json
{
  "default_dataset": "swe-bench-lite",
  "timeout_seconds": 3600,
  "docker_image_swe_bench": "copilot-cli-swe-bench:latest",
  "docker_image_arc": "copilot-cli-arc:latest",
  "parallel_workers": 4,
  "output_directory": "./results"
}
```

## Dataset Information

### SWE-bench

- **Source**: [SWE-bench on HuggingFace](https://huggingface.co/datasets/SWE-bench)
- **Size**: Full (2,294), Lite (300), Verified (500) instances
- **Format**: JSONL (one instance per line)
- **Key fields**:
  - `instance_id`: Unique identifier
  - `repo`: Repository (owner/name)
  - `base_commit`: Commit hash before fix
  - `problem_statement`: Issue description
  - `patch`: Gold patch solution
  - `test_patch`: Test validation script

### ARC-AGI-2

- **Source**: [ARC-AGI on GitHub](https://github.com/fchollet/ARC-AGI)
- **Size**: ~120 evaluation tasks
- **Format**: JSON files (one task per file)
- **Key fields**:
  - `train`: Array of input/output examples
  - `test`: Array of test inputs to predict outputs for
  - Grids: 2D arrays of integers 0-9 (representing colors)

## Results Format

### JSON Output

```json
{
  "dataset": "swe-bench-lite",
  "total_instances": 300,
  "completed": 300,
  "passed": 145,
  "passed_rate": 0.483,
  "total_time_seconds": 450000,
  "average_time_per_task": 1500,
  "average_iterations": 45,
  "timestamp": "2024-01-01T12:00:00Z",
  "results": [
    {
      "task_id": "django__django-12345",
      "dataset": "swe-bench-lite",
      "status": "completed",
      "passed": true,
      "time_seconds": 1200,
      "iterations": 35,
      "verification_passed": true
    }
  ]
}
```

### CSV Output

Includes columns: task_id, status, passed, time_seconds, iterations, dataset, etc.

## Troubleshooting

### Docker Issues

```bash
# Check if Docker is running
docker ps

# Verify image was built
docker images | grep copilot-cli

# Check container logs
docker logs <container_id>
```

### Dataset Loading Issues

```bash
# Verify dataset download
ls -la data/swe-bench-lite/

# Check file format
head -1 data/swe-bench-lite/data.jsonl | jq .

# For ARC, verify structure
ls -la data/arc-agi-2/training/ | head
```

### Performance Tips

1. **Use SWE-bench-lite** for testing (300 instances vs 2,294)
2. **Parallel execution** can speed up evaluation (use `-p` flag)
3. **Cache datasets locally** to avoid re-downloading
4. **Checkpoint frequently** with `--resume` for long runs

## Next Steps

1. ✅ **Core Infrastructure** - Completed
2. ⏳ **Benchmark Runner** - Integrate with agent loop
3. ⏳ **Full Evaluation** - Run on sample tasks
4. ⏳ **Documentation** - Usage examples and tutorials
5. ⏳ **Optimization** - Parallel execution, caching

## References

- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [SWE-bench Official](https://www.swebench.com/)
- [ARC-AGI Prize](https://arcprize.org/)
- [ARC-AGI Repository](https://github.com/fchollet/ARC-AGI)
- [ARC Prize 2025 Results](https://arcprize.org/blog/arc-prize-2025-results-analysis)
