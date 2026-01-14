#!/bin/bash
# Run SWE-bench evaluation using official tool

set -e

echo "🚀 Starting SWE-bench Evaluation"
echo "================================"

# Parse arguments
DATASET=${1:-swe-bench-lite}
SPLIT=${2:-test}
MAX_WORKERS=${3:-4}

echo "Dataset: $DATASET"
echo "Split: $SPLIT"
echo "Max Workers: $MAX_WORKERS"
echo ""

# Run evaluation using SWE-bench official tool
cd /swe-bench

python -m swebench.harness.run_evaluation \
    --dataset_name "$DATASET" \
    --split "$SPLIT" \
    --predictions_path gold \
    --max_workers "$MAX_WORKERS" \
    --run_id "copilot-cli-baseline"

echo ""
echo "✅ Evaluation complete!"
echo "Results saved to: /swe-bench/results/"
