//! Node `child_process` IPC with `serialization: 'json'`: one JSON value per line on the
//! inherited `NODE_CHANNEL_FD`. Node-internal messages (`{"cmd":"NODE_..."}`) are ignored.
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{FromRawFd, OwnedFd};
use std::sync::mpsc::Sender;

/// Largest accepted inbound line; the host never sends more (renderer payloads are bounded).
pub const MAX_LINE: usize = 1024 * 1024;

pub enum Inbound {
    Message(Value),
    Closed,
}

pub struct Channel {
    writer: std::fs::File,
}

impl Channel {
    /// Takes ownership of `NODE_CHANNEL_FD`. Refuses any other serialization mode.
    pub fn from_env() -> Result<(Channel, std::fs::File), String> {
        if std::env::var("NODE_CHANNEL_SERIALIZATION_MODE")
            .as_deref()
            .unwrap_or("json")
            != "json"
        {
            return Err("Unsupported IPC serialization".into());
        }
        let fd: i32 = std::env::var("NODE_CHANNEL_FD")
            .map_err(|_| "Private Node IPC only".to_owned())?
            .parse()
            .map_err(|_| "Invalid IPC fd".to_owned())?;
        if fd < 3 {
            return Err("Invalid IPC fd".into());
        }
        // SAFETY: Node passed this inherited socket for our exclusive use.
        let owned = unsafe { OwnedFd::from_raw_fd(fd) };
        let reader = std::fs::File::from(owned);
        let writer = reader.try_clone().map_err(|e| e.to_string())?;
        Ok((Channel { writer }, reader))
    }

    pub fn send(&mut self, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.writer.write_all(&line).map_err(|e| e.to_string())
    }

    /// `process.disconnect()`: close the channel so the parent observes 'disconnect'.
    pub fn disconnect(self) {
        // SAFETY: shutting down our own socket.
        unsafe {
            libc::shutdown(
                std::os::fd::AsRawFd::as_raw_fd(&self.writer),
                libc::SHUT_RDWR,
            );
        }
    }
}

/// Reads inbound lines on a thread until EOF, then reports `Closed` once.
pub fn spawn_reader<T: Send + 'static>(
    reader: std::fs::File,
    out: Sender<T>,
    wrap: fn(Inbound) -> T,
) {
    std::thread::spawn(move || {
        let mut lines = BufReader::new(reader);
        let mut line = Vec::new();
        loop {
            line.clear();
            match std::io::Read::by_ref(&mut lines)
                .take(MAX_LINE as u64 + 1)
                .read_until(b'\n', &mut line)
            {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > MAX_LINE => break,
                Ok(_) => {}
            }
            let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                break;
            };
            if value
                .get("cmd")
                .and_then(Value::as_str)
                .is_some_and(|c| c.starts_with("NODE_"))
            {
                continue;
            }
            if out.send(wrap(Inbound::Message(value))).is_err() {
                return;
            }
        }
        let _ = out.send(wrap(Inbound::Closed));
    });
}
