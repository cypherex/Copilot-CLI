"""Download real benchmark datasets from HuggingFace"""

import json
import sys
from pathlib import Path

try:
    from datasets import load_dataset
except ImportError:
    print("Installing datasets library...")
    import subprocess
    subprocess.check_call(["pip", "install", "-q", "datasets"])
    from datasets import load_dataset

print("[*] Downloading real SWE-bench-lite dataset...")
dataset = load_dataset("SWE-bench/SWE-bench_Lite", split="test")
print(f"    Loaded {len(dataset)} instances")

# Convert to JSONL format
output_file = Path(".benchmark-cache/swe-bench-lite.jsonl")
output_file.parent.mkdir(parents=True, exist_ok=True)

print(f"[*] Writing to {output_file}...")
with open(output_file, 'w') as f:
    for i, instance in enumerate(dataset):
        f.write(json.dumps(instance) + '\n')
        if (i + 1) % 50 == 0:
            print(f"    Wrote {i + 1} instances...")

print(f"[OK] SWE-bench-lite: {len(dataset)} instances saved")

print("\n[*] Downloading real ARC-AGI-2 dataset...")
try:
    arc_dataset = load_dataset("arcprize/arc-agi-2-public-agi-eval-set", split="test")
    print(f"    Loaded {len(arc_dataset)} tasks")
    
    # Create ARC directory
    arc_dir = Path("data/arc-agi-2/evaluation")
    arc_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"[*] Writing ARC tasks...")
    for i, task in enumerate(arc_dataset):
        task_id = task.get('task_id', f'task_{i:06d}')
        task_file = arc_dir / f"{task_id}.json"
        
        # Extract train/test data
        task_data = {
            "train": task.get("train", []),
            "test": task.get("test", [])
        }
        
        with open(task_file, 'w') as f:
            json.dump(task_data, f)
        
        if (i + 1) % 20 == 0:
            print(f"    Wrote {i + 1} tasks...")
    
    print(f"[OK] ARC-AGI-2: {len(arc_dataset)} tasks saved")
except Exception as e:
    print(f"[!] Could not download ARC-AGI-2: {e}")
    print("    Will continue with sample data")

print("\n[OK] Dataset download complete!")
