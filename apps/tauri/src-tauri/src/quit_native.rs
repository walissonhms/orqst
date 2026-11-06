//! Effect adapters for the shared Quit circuit. No decisions live in this module.
use crate::quit_orchestration::{AgentsGate, ExitPort, TerminalPipe, Timer, QUIT};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::oneshot;

pub struct NativePorts(tauri::AppHandle);

impl AgentsGate for NativePorts {
    fn active(&self) -> bool {
        crate::agents::owned_active(&self.0)
    }

    fn confirm_exit(&self) -> bool {
        crate::agents::confirm_exit(&self.0)
    }
}

impl TerminalPipe for NativePorts {
    fn request_id(&self) -> String {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        let mut bytes = [0u8; 16];
        for (index, chunk) in bytes.chunks_mut(8).enumerate() {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u64(index as u64);
            chunk.copy_from_slice(&hasher.finish().to_le_bytes());
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        format!(
            "{}-{}-{}-{}-{}",
            &hex[0..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..32]
        )
    }

    fn send(&self, id: &str, kind: &str) -> Option<oneshot::Receiver<Value>> {
        crate::terminal::quit_send(&self.0, id, kind)
    }

    fn cancel(&self, id: &str) {
        crate::terminal::quit_cancel(&self.0, id);
    }

    fn confirm_exit(&self) -> bool {
        crate::terminal::confirm_exit(&self.0)
    }
}

impl ExitPort for NativePorts {
    fn confirm_owned_quit(&self) -> bool {
        crate::terminal::confirm_exit(&self.0)
    }

    fn request_exit(&self) {
        self.0.exit(0);
    }

    fn start_owned_shutdown(&self) {
        let ports = Self(self.0.clone());
        tauri::async_runtime::spawn(async move {
            QUIT.quit_owned(&ports, &ports, &ports).await;
        });
    }

    fn blocked(&self, reason: &str, uncertain: Value) {
        crate::terminal::quit_event(
            &self.0,
            "orqst-quit-blocked",
            json!({"reason": reason, "uncertain": uncertain}),
        );
    }

    fn fence(&self) {
        crate::terminal::quit_event(&self.0, "orqst-terminal-fence", json!({"fence": true}));
    }
}

impl Timer for NativePorts {
    async fn wait(&self, duration: Duration, receiver: oneshot::Receiver<Value>) -> Option<Value> {
        match tokio::time::timeout(duration, receiver).await {
            Ok(Ok(value)) => Some(value),
            _ => None,
        }
    }
}

pub fn request_quit(app: &tauri::AppHandle) {
    let ports = NativePorts(app.clone());
    QUIT.request_quit(&ports, &ports);
}

pub fn exit_requested(app: &tauri::AppHandle) -> bool {
    let ports = NativePorts(app.clone());
    QUIT.exit_requested(&ports, &ports, &ports)
}

pub fn agents_approved(app: &tauri::AppHandle) {
    QUIT.agents_approved(&NativePorts(app.clone()));
}
