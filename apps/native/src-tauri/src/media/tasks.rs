use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::Arc;

use parking_lot::Mutex;

#[derive(Clone, Default)]
pub struct NativeMediaTasks {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    /// Task ids that were explicitly cancelled, so a non-zero exit can be reported
    /// as a cancellation rather than an opaque ffmpeg failure.
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl NativeMediaTasks {
    pub(crate) fn insert(&self, task_id: &str, child: Child) -> Arc<Mutex<Child>> {
        let child = Arc::new(Mutex::new(child));
        let was_cancelled = self.cancelled.lock().contains(task_id);
        // Reusing a task id while a previous process is still registered would
        // orphan that process (cancel only ever sees the latest). Kill the old one.
        let previous = self
            .children
            .lock()
            .insert(task_id.to_string(), child.clone());
        if let Some(previous) = previous {
            let mut guard = previous.lock();
            let _ = guard.kill();
            let _ = guard.wait();
        }
        if was_cancelled {
            let mut guard = child.lock();
            let _ = guard.kill();
            let _ = guard.wait();
        }
        child
    }

    pub(crate) fn remove(&self, task_id: &str) {
        self.children.lock().remove(task_id);
        self.cancelled.lock().remove(task_id);
    }

    pub(crate) fn was_cancelled(&self, task_id: &str) -> bool {
        self.cancelled.lock().contains(task_id)
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        self.cancelled.lock().insert(task_id.to_string());
        let child = self.children.lock().get(task_id).cloned();
        let Some(child) = child else {
            return false;
        };
        let mut child = child.lock();
        let _ = child.kill();
        let _ = child.wait();
        true
    }
}
