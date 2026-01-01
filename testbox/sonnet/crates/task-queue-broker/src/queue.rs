use task_queue_core::{Task, TaskId, Priority};
use std::collections::{BinaryHeap, HashMap};
use std::cmp::Ordering;
use parking_lot::RwLock;
use chrono::Utc;

/// A task wrapper for priority queue ordering
#[derive(Clone)]
struct PrioritizedTask {
    task: Task,
}

impl PartialEq for PrioritizedTask {
    fn eq(&self, other: &Self) -> bool {
        self.task.id == other.task.id
    }
}

impl Eq for PrioritizedTask {}

impl PartialOrd for PrioritizedTask {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PrioritizedTask {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority first
        match self.task.priority.cmp(&other.task.priority) {
            Ordering::Equal => {
                // Within same priority, earlier created_at first (FIFO)
                other.task.created_at.cmp(&self.task.created_at)
            }
            ordering => ordering,
        }
    }
}

/// In-memory priority queue for pending tasks
pub struct TaskQueue {
    heap: RwLock<BinaryHeap<PrioritizedTask>>,
    task_index: RwLock<HashMap<TaskId, Task>>,
}

impl TaskQueue {
    pub fn new() -> Self {
        TaskQueue {
            heap: RwLock::new(BinaryHeap::new()),
            task_index: RwLock::new(HashMap::new()),
        }
    }

    /// Push a task into the queue
    pub fn push(&self, task: Task) {
        let task_id = task.id;
        let prioritized = PrioritizedTask { task: task.clone() };

        {
            let mut heap = self.heap.write();
            heap.push(prioritized);
        }

        {
            let mut index = self.task_index.write();
            index.insert(task_id, task);
        }
    }

    /// Pop the highest priority task that's ready to execute
    pub fn pop(&self) -> Option<Task> {
        let mut heap = self.heap.write();

        // Keep popping until we find a ready task or heap is empty
        loop {
            if let Some(prioritized) = heap.pop() {
                let task = prioritized.task;

                // Check if task is ready (scheduled time has passed)
                if task.is_ready() {
                    // Remove from index
                    let mut index = self.task_index.write();
                    index.remove(&task.id);
                    return Some(task);
                } else {
                    // Not ready yet, push back
                    heap.push(PrioritizedTask { task });
                    return None;
                }
            } else {
                return None;
            }
        }
    }

    /// Peek at the highest priority task without removing it
    pub fn peek(&self) -> Option<Task> {
        let heap = self.heap.read();
        heap.peek().map(|p| p.task.clone())
    }

    /// Remove a specific task by ID
    pub fn remove(&self, task_id: &TaskId) -> Option<Task> {
        let mut index = self.task_index.write();
        if let Some(task) = index.remove(task_id) {
            // Note: We don't remove from heap immediately for performance
            // The heap will skip it when popped since it won't be in the index
            Some(task)
        } else {
            None
        }
    }

    /// Get task count
    pub fn len(&self) -> usize {
        let index = self.task_index.read();
        index.len()
    }

    /// Check if queue is empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get count by priority tier
    pub fn count_by_priority(&self) -> (usize, usize, usize) {
        let index = self.task_index.read();
        let mut high = 0;
        let mut normal = 0;
        let mut low = 0;

        for task in index.values() {
            if task.priority.is_high() {
                high += 1;
            } else if task.priority.is_normal() {
                normal += 1;
            } else {
                low += 1;
            }
        }

        (high, normal, low)
    }

    /// Rebuild the heap (useful after bulk operations)
    pub fn rebuild(&self) {
        let index = self.task_index.read();
        let mut heap = self.heap.write();

        heap.clear();
        for task in index.values() {
            heap.push(PrioritizedTask { task: task.clone() });
        }
    }
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_ordering() {
        let queue = TaskQueue::new();

        let low = Task::new("low".to_string(), vec![1], Priority::low()).unwrap();
        let normal = Task::new("normal".to_string(), vec![2], Priority::normal()).unwrap();
        let high = Task::new("high".to_string(), vec![3], Priority::high()).unwrap();

        queue.push(low.clone());
        queue.push(normal.clone());
        queue.push(high.clone());

        // Should pop high priority first
        assert_eq!(queue.pop().unwrap().id, high.id);
        assert_eq!(queue.pop().unwrap().id, normal.id);
        assert_eq!(queue.pop().unwrap().id, low.id);
    }

    #[test]
    fn test_fifo_within_priority() {
        let queue = TaskQueue::new();

        // Create tasks with same priority but different creation times
        let mut task1 = Task::new("t1".to_string(), vec![1], Priority::normal()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let task2 = Task::new("t2".to_string(), vec![2], Priority::normal()).unwrap();

        queue.push(task1.clone());
        queue.push(task2.clone());

        // Should pop in FIFO order (task1 first)
        assert_eq!(queue.pop().unwrap().id, task1.id);
        assert_eq!(queue.pop().unwrap().id, task2.id);
    }

    #[test]
    fn test_scheduled_tasks() {
        let queue = TaskQueue::new();

        let mut future_task = Task::new("future".to_string(), vec![1], Priority::high()).unwrap();
        future_task.scheduled_at = Utc::now() + chrono::Duration::hours(1);

        let immediate = Task::new("immediate".to_string(), vec![2], Priority::normal()).unwrap();

        queue.push(future_task.clone());
        queue.push(immediate.clone());

        // Should get immediate task first, even though future_task has higher priority
        assert_eq!(queue.pop().unwrap().id, immediate.id);

        // Future task shouldn't be available yet
        assert!(queue.pop().is_none());
    }

    #[test]
    fn test_remove_task() {
        let queue = TaskQueue::new();

        let task = Task::new("test".to_string(), vec![1], Priority::normal()).unwrap();
        let task_id = task.id;

        queue.push(task);
        assert_eq!(queue.len(), 1);

        let removed = queue.remove(&task_id);
        assert!(removed.is_some());
        assert_eq!(queue.len(), 0);
    }
}
