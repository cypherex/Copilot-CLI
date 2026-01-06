#!/usr/bin/env python3
"""
Extract task hierarchy from session.txt after recursive breakdown.
Parses the breakdown output and creates a structured visualization.
"""

import re
import json
from collections import defaultdict
from typing import Dict, List, Optional, Tuple


class Task:
    def __init__(self, task_id: str, description: str, parent_id: Optional[str] = None):
        self.task_id = task_id
        self.description = description
        self.parent_id = parent_id
        self.children: List[Task] = []
        self.depth = 0
        self.complexity = None
        self.ready_to_spawn = None

    def __repr__(self):
        return f"Task({self.task_id}, {self.description[:50]}...)"


def extract_tasks_from_session(file_path: str) -> Tuple[Dict[str, Task], List[str]]:
    """
    Extract all tasks from session.txt
    Returns: (tasks_dict, root_task_ids)
    """
    tasks = {}
    root_ids = []

    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # Pattern 1: Look for task creation in recursive breakdown output
    # Example: "[Depth 0] Analyzing: "Build complete Flux compiler""
    depth_pattern = r'\[Depth (\d+)\] Analyzing: "([^"]+)"'

    # Pattern 2: Look for task IDs being created
    # Example: "- Parent Task ID: task_123_abc"
    task_id_pattern = r'(?:Parent Task ID|Task ID|task_id):\s*([a-zA-Z0-9_]+)'

    # Pattern 3: Look for subtask listings
    # Example: "Created 5 subtasks"
    subtask_pattern = r'Created (\d+) subtasks'

    # Pattern 4: Look for breakdown sections with task details
    breakdown_section_pattern = r'STARTING RECURSIVE TASK BREAKDOWN.*?BREAKDOWN COMPLETE'

    # Find the main breakdown section
    breakdown_sections = re.findall(breakdown_section_pattern, content, re.DOTALL)

    # If no section markers found, use entire content
    if not breakdown_sections:
        print("Warning: No section markers found, analyzing entire file...")
        breakdown_content = content
    else:
        # Use the last (most recent) breakdown section
        breakdown_content = breakdown_sections[-1]

    # Extract all depth analyses
    depth_matches = re.finditer(depth_pattern, breakdown_content)

    # Build a hierarchy based on depth
    depth_stack = {}  # depth -> current task at that depth
    task_counter = 0

    for match in depth_matches:
        depth = int(match.group(1))
        description = match.group(2)

        # Generate task ID
        task_id = f"task_{task_counter:04d}"
        task_counter += 1

        # Determine parent
        parent_id = None
        if depth > 0:
            parent_id = depth_stack.get(depth - 1)

        # Create task
        task = Task(task_id, description, parent_id)
        task.depth = depth
        tasks[task_id] = task

        # Update depth stack
        depth_stack[depth] = task_id
        # Clear deeper levels
        depth_stack = {d: tid for d, tid in depth_stack.items() if d <= depth}

        # Track root tasks
        if depth == 0:
            root_ids.append(task_id)

        # Link to parent
        if parent_id and parent_id in tasks:
            tasks[parent_id].children.append(task)

    # Try to extract complexity and ready status
    complexity_pattern = r'→ Complexity: (SIMPLE|MODERATE|COMPLEX)'
    ready_pattern = r'✓ Ready to spawn'

    lines = breakdown_content.split('\n')
    current_task_idx = 0
    task_list = list(tasks.values())

    for line in lines:
        if '[Depth' in line:
            if current_task_idx < len(task_list):
                current_task = task_list[current_task_idx]
                current_task_idx += 1
        elif '→ Complexity:' in line and current_task_idx > 0:
            complexity_match = re.search(r'Complexity: (\w+)', line)
            if complexity_match and current_task_idx <= len(task_list):
                task_list[current_task_idx - 1].complexity = complexity_match.group(1).lower()
        elif '✓ Ready to spawn' in line and current_task_idx > 0:
            if current_task_idx <= len(task_list):
                task_list[current_task_idx - 1].ready_to_spawn = True

    return tasks, root_ids


def print_tree(task: Task, tasks: Dict[str, Task], indent: int = 0, prefix: str = ""):
    """Print task tree with nice formatting"""

    # Status indicator (using ASCII-safe characters for Windows)
    if task.ready_to_spawn:
        status = "[OK]"
    elif task.ready_to_spawn is False:
        status = "[!!]"
    else:
        status = "[ ?]"

    # Complexity indicator
    complexity_str = ""
    if task.complexity:
        complexity_colors = {
            'simple': 'S',
            'moderate': 'M',
            'complex': 'C'
        }
        complexity_str = f" [{complexity_colors.get(task.complexity, '?')}]"

    # Print current task
    indent_str = "  " * indent
    print(f"{indent_str}{prefix}{status} {task.description}{complexity_str}")

    # Print children
    for i, child in enumerate(task.children):
        is_last = i == len(task.children) - 1
        child_prefix = "`- " if is_last else "+- "
        print_tree(child, tasks, indent + 1, child_prefix)


def print_statistics(tasks: Dict[str, Task], root_ids: List[str]):
    """Print statistics about the task hierarchy"""

    total_tasks = len(tasks)
    ready_tasks = sum(1 for t in tasks.values() if t.ready_to_spawn)

    complexity_counts = defaultdict(int)
    for task in tasks.values():
        if task.complexity:
            complexity_counts[task.complexity] += 1

    max_depth = max(t.depth for t in tasks.values()) if tasks else 0

    print("=" * 70)
    print("TASK HIERARCHY STATISTICS")
    print("=" * 70)
    print(f"Total Tasks: {total_tasks}")
    print(f"Root Tasks: {len(root_ids)}")
    print(f"Ready to Spawn: {ready_tasks}")
    print(f"Max Depth: {max_depth}")
    print()
    print("Complexity Distribution:")
    for complexity in ['simple', 'moderate', 'complex']:
        count = complexity_counts.get(complexity, 0)
        percentage = (count / total_tasks * 100) if total_tasks > 0 else 0
        print(f"  {complexity.capitalize()}: {count} ({percentage:.1f}%)")
    print("=" * 70)
    print()


def export_to_json(tasks: Dict[str, Task], root_ids: List[str], output_file: str):
    """Export task hierarchy to JSON"""

    def task_to_dict(task: Task) -> dict:
        return {
            'id': task.task_id,
            'description': task.description,
            'parent_id': task.parent_id,
            'depth': task.depth,
            'complexity': task.complexity,
            'ready_to_spawn': task.ready_to_spawn,
            'children': [task_to_dict(child) for child in task.children]
        }

    output = {
        'total_tasks': len(tasks),
        'root_tasks': len(root_ids),
        'roots': [task_to_dict(tasks[rid]) for rid in root_ids if rid in tasks]
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f"Exported hierarchy to {output_file}")


def main():
    import sys

    # File path
    session_file = 'session.txt'

    print(f"Reading {session_file}...")
    print()

    # Extract tasks
    tasks, root_ids = extract_tasks_from_session(session_file)

    if not tasks:
        print("No tasks found in session.txt")
        return

    # Print statistics
    print_statistics(tasks, root_ids)

    # Print tree
    print("TASK HIERARCHY TREE")
    print("=" * 70)
    print("Legend: [OK] = Ready to spawn, [!!] = Needs work, [ ?] = Unknown")
    print("        [S] = Simple, [M] = Moderate, [C] = Complex")
    print()

    for root_id in root_ids:
        if root_id in tasks:
            print_tree(tasks[root_id], tasks)
            print()

    # Export to JSON
    export_to_json(tasks, root_ids, 'task_hierarchy.json')

    # Save tree to file
    print("\nSaving tree visualization to task_hierarchy_tree.txt...")

    import io
    from contextlib import redirect_stdout

    with open('task_hierarchy_tree.txt', 'w', encoding='utf-8') as f:
        with redirect_stdout(f):
            print_statistics(tasks, root_ids)
            print("TASK HIERARCHY TREE")
            print("=" * 70)
            print("Legend: [OK] = Ready to spawn, [!!] = Needs work, [ ?] = Unknown")
            print("        [S] = Simple, [M] = Moderate, [C] = Complex")
            print()

            for root_id in root_ids:
                if root_id in tasks:
                    print_tree(tasks[root_id], tasks)
                    print()

    print("Done!")
    print("\nOutput files created:")
    print("  - task_hierarchy.json (structured data)")
    print("  - task_hierarchy_tree.txt (visual tree)")


if __name__ == '__main__':
    main()
