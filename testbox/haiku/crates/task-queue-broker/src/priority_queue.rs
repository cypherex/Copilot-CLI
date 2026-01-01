//! Priority queue for managing tasks.

use parking_lot::RwLock;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use task_queue_core::task::{Task, TaskId};
use task_queue_core::priority::PriorityTier;

/// Priority queue for pending tasks.
pub struct PriorityQueue {
    // Binary heap storing tasks (reversed for min-heap behavior)
    heap: RwLock<BinaryHeap<Reverse<Task>>>,
    // Index for O(1) lookup
    index: RwLock<HashMap<TaskId, Task>>,
}

impl PriorityQueue {
    /// Create a new priority queue.
    pub fn new() -> Self {
        Self {
            heap: RwLock::new(BinaryHeap::new()),
            index: RwLock::new(HashMap::new()),
        }
    }

    /// Add a task to the queue.
    pub fn push(&self, task: Task) {
        let task_id = task.id;
        let mut heap = self.heap.write();
        let mut index = self.index.write();

        heap.push(Reverse(task.clone()));
        index.insert(task_id, task);
    }

    /// Pop the highest priority task from the queue.
    pub fn pop(&self) -> Option<Task> {
        let mut heap = self.heap.write();
        let mut index = self.index.write();

        // Find the next non-removed task
        while let Some(Reverse(task)) = heap.pop() {
            if index.contains_key(&task.id) {
                index.remove(&task.id);
                return Some(task);
            }
        }
        None
    }

    /// Get a task by ID without removing it.
    pub fn get(&self, task_id: TaskId) -> Option<Task> {
        let index = self.index.read();
        index.get(&task_id).cloned()
    }

    /// Remove a task by ID (for cancellation).
    pub fn remove(&self, task_id: TaskId) -> Option<Task> {
        let mut index = self.index.write();
        index.remove(&task_id)
    }

    /// Get the number of tasks in the queue.
    pub fn len(&self) -> usize {
        let index = self.index.read();
        index.len()
    }

    /// Check if queue is empty.
    pub fn is_empty(&self) -> bool {
        let index = self.index.read();
        index.is_empty()
    }

    /// Get queue depth by priority tier.
    pub fn depth_by_priority(&self) -> (usize, usize, usize) {
        let index = self.index.read();
        let mut high = 0;
        let mut normal = 0;
        let mut low = 0;

        for task in index.values() {
            match task.priority_tier() {
                PriorityTier::High => high += 1,
                PriorityTier::Normal => normal += 1,
                PriorityTier::Low => low += 1,
            }
        }

        (high, normal, low)
    }

    /// Get all tasks for iteration (snapshot).
    pub fn iter(&self) -> Vec<Task> {
        let index = self.index.read();
        let mut tasks: Vec<_> = index.values().cloned().collect();
        tasks.sort();
        tasks
    }
}

impl Default for PriorityQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_queue_ordering() {
        let queue = PriorityQueue::new();

        let low = Task::new("low".to_string(), vec![]).with_priority(50);
        let high = Task::new("high".to_string(), vec![]).with_priority(200);
        let normal = Task::new("normal".to_string(), vec![]).with_priority(150);

        queue.push(low.clone());
        queue.push(normal.clone());
        queue.push(high.clone());

        // Should pop in order: high, normal, low
        assert_eq!(queue.pop().unwrap().id, high.id);
        assert_eq!(queue.pop().unwrap().id, normal.id);
        assert_eq!(queue.pop().unwrap().id, low.id);
        assert!(queue.pop().is_none());
    }

    #[test]
    fn test_priority_queue_get() {
        let queue = PriorityQueue::new();
        let task = Task::new("test".to_string(), vec![]);
        let task_id = task.id;

        queue.push(task.clone());
        assert_eq!(queue.get(task_id).unwrap().id, task_id);
    }

    #[test]
    fn test_priority_queue_remove() {
        let queue = PriorityQueue::new();
        let task = Task::new("test".to_string(), vec![]);
        let task_id = task.id;

        queue.push(task);
        assert_eq!(queue.len(), 1);
        assert!(queue.remove(task_id).is_some());
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn test_priority_queue_depth() {
        let queue = PriorityQueue::new();

        queue.push(Task::new("low".to_string(), vec![]).with_priority(50));
        queue.push(Task::new("normal".to_string(), vec![]).with_priority(150));
        queue.push(Task::new("high".to_string(), vec![]).with_priority(220));

        let (high, normal, low) = queue.depth_by_priority();
        assert_eq!(high, 1);
        assert_eq!(normal, 1);
        assert_eq!(low, 1);
    }
}
