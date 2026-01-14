#!/usr/bin/env python3
"""Test ARC evaluator with sample grid transformation."""

import json
import sys
import numpy as np

def transform(grid):
    """Invert grid: turn 0s to 1s and 1s to 0s."""
    grid = np.array(grid)
    return (1 - grid).tolist()

# Test on first task (007bbfb7)
task = {
    "task_id": "007bbfb7",
    "train": [
        {"input": [[0, 0, 0], [0, 1, 0], [0, 0, 0]], "output": [[1, 1, 1], [1, 0, 1], [1, 1, 1]]},
        {"input": [[0, 0, 0, 0], [0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]], "output": [[1, 1, 1, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 1, 1, 1]]}
    ],
    "test": [
        {"input": [[0, 0, 0], [0, 1, 0], [0, 0, 0]], "output": [[1, 1, 1], [1, 0, 1], [1, 1, 1]]}
    ]
}

print("Testing transformation function...")
print("\nTraining examples:")
correct = 0
for i, example in enumerate(task["train"]):
    result = transform(example["input"])
    expected = example["output"]
    match = result == expected
    print(f"  Example {i+1}: {'✓' if match else '✗'}")
    if match:
        correct += 1

print(f"\nTraining accuracy: {correct}/{len(task['train'])} ({100*correct//len(task['train'])}%)")

print("\nTest examples:")
test_correct = 0
for i, example in enumerate(task["test"]):
    result = transform(example["input"])
    expected = example["output"]
    match = result == expected
    print(f"  Example {i+1}: {'✓' if match else '✗'}")
    if match:
        test_correct += 1

print(f"\nTest accuracy: {test_correct}/{len(task['test'])} ({100*test_correct//len(task['test'])}%)")

if test_correct == len(task["test"]):
    print("\n✓ PASSED")
    sys.exit(0)
else:
    print("\n✗ FAILED")
    sys.exit(1)
