//! Registry of running child processes (conversions and downloads), so the UI can cancel them by id.

use std::collections::{HashMap, HashSet};
use std::process::{Child, ExitStatus};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct Jobs {
    running: Mutex<HashMap<String, Child>>,
    cancelled: Mutex<HashSet<String>>,
}

/// How a registered process ended.
pub enum Outcome {
    Cancelled,
    Exited(Option<ExitStatus>),
}

impl Jobs {
    /// Starts tracking `child` under `id`. Take its stdout/stderr before calling this.
    pub fn register(&self, id: &str, child: Child) {
        self.running.lock().unwrap().insert(id.to_string(), child);
    }

    /// Stops tracking `id`, waits for the process to exit and reports whether it was cancelled.
    pub fn finish(&self, id: &str) -> Outcome {
        let child = self.running.lock().unwrap().remove(id);
        let status = child.and_then(|mut c| c.wait().ok());
        if self.cancelled.lock().unwrap().remove(id) {
            Outcome::Cancelled
        } else {
            Outcome::Exited(status)
        }
    }

    pub fn cancel(&self, id: &str) {
        if let Some(child) = self.running.lock().unwrap().get_mut(id) {
            self.cancelled.lock().unwrap().insert(id.to_string());
            let _ = child.kill();
        }
    }
}

/// Cancels a running conversion or download.
#[tauri::command]
pub fn cancel_job(jobs: State<'_, std::sync::Arc<Jobs>>, id: String) {
    jobs.cancel(&id);
}
