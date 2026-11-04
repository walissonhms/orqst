// Minimal transport stand-ins: the production lock, ownership, removal and completion bodies
// are compiled verbatim. This harness does not compile Tauri, Tokio or schema validation.
struct Terminals(Mutex<Option<Running>>);
struct Running {
    epoch: String,
    layout_generation: u64,
    metadata_pending: HashMap<String, MetadataPending>,
    metadata_mutating: Option<String>,
}
mod tauri {
    pub(crate) struct AppHandle(pub(super) super::Terminals);
    impl AppHandle {
        pub(super) fn state<T>(&self) -> &super::Terminals {
            let _ = std::marker::PhantomData::<T>;
            &self.0
        }
    }
}
fn advance_layout(r: &mut Running) {
    r.layout_generation += 1;
}
fn entry() -> (MetadataPending, std::sync::mpsc::Receiver<()>) {
    let (sender, receiver) = std::sync::mpsc::channel();
    (
        MetadataPending {
            source: "synthetic-main".into(),
            document: 3,
            generation: 4,
            sender,
            owner: Arc::new(()),
        },
        receiver,
    )
}
fn running() -> (Running, std::sync::mpsc::Receiver<()>) {
    let (pending, receiver) = entry();
    (
        Running {
            epoch: "synthetic-original-core".into(),
            layout_generation: 4,
            metadata_pending: HashMap::from([("request".into(), pending)]),
            metadata_mutating: Some("request".into()),
        },
        receiver,
    )
}
#[test]
fn reply_wait_releases_lock_and_revalidates_exact_pending_owner_before_ack() {
    use std::sync::mpsc;
    use std::time::Duration;
    for change in 0..8 {
        let (original, receiver) = running();
        let state = Arc::new(Mutex::new(Some(original)));
        let (started, waiting) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        let task_state = state.clone();
        let version = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let task_version = version.clone();
        let worker = std::thread::spawn(move || {
            let pending = take_metadata_reply(
                &task_state,
                "synthetic-original-core",
                "request",
                |p, generation| p.document == 3 && p.generation == generation,
                |source, document| {
                    assert_eq!((source, document), ("synthetic-main", 3));
                    started.send(()).unwrap();
                    resumed.recv_timeout(Duration::from_secs(2)).unwrap();
                    true // Getter can return stale success after the callback.
                },
                |_, _| task_version.load(std::sync::atomic::Ordering::SeqCst),
            );
            if let Some(pending) = pending {
                pending.sender.send(()).unwrap();
                true
            } else {
                false
            }
        });
        waiting.recv_timeout(Duration::from_secs(2)).unwrap();
        let mut replacement_receiver = None;
        {
            let mut guard = state
                .try_lock()
                .expect("Terminals must be free during UI wait");
            let r = guard.as_mut().unwrap();
            match change {
                1 => r.layout_generation += 1,
                2 => r.metadata_pending.get_mut("request").unwrap().document += 1,
                3 => r.metadata_pending.get_mut("request").unwrap().source = "new-document".into(),
                4 => {
                    // Same id/version/source, different request instance must not be consumed.
                    let (next, rx) = entry();
                    r.metadata_pending.insert("request".into(), next);
                    replacement_receiver = Some(rx);
                }
                5 => {
                    // New Core can have the same request id and generation.
                    let (mut next, rx) = running();
                    next.epoch = "synthetic-new-core".into();
                    *r = next;
                    replacement_receiver = Some(rx);
                }
                6 => {
                    // Features invalidated, but its Terminals invalidation is still pending.
                    version.store(false, std::sync::atomic::Ordering::SeqCst);
                }
                7 => {
                    r.metadata_pending.remove("request");
                    r.metadata_mutating = Some("next".into());
                }
                _ => {}
            }
        }
        resume.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), change == 0);
        assert_eq!(receiver.try_recv().is_ok(), change == 0);
        if let Some(receiver) = replacement_receiver {
            assert!(receiver.try_recv().is_err());
        }
        let guard = state.lock().unwrap();
        let r = guard.as_ref().unwrap();
        assert_eq!(
            r.metadata_mutating.as_deref(),
            Some(if change == 7 { "next" } else { "request" })
        );
        if change == 4 || change == 5 {
            assert!(r.metadata_pending.contains_key("request"));
        }
    }
}
#[test]
fn late_completion_never_releases_another_core_or_another_requests_latch() {
    for (epoch, id, allowed) in [
        ("synthetic-original-core", "request", true),
        ("synthetic-old-core", "request", false),
        ("synthetic-original-core", "previous", false),
    ] {
        let (r, _receiver) = running();
        let app = tauri::AppHandle(Terminals(Mutex::new(Some(r))));
        metadata_finish(&app, epoch, id, true);
        let guard = app.0 .0.lock().unwrap();
        let r = guard.as_ref().unwrap();
        assert_eq!(r.metadata_mutating.is_none(), allowed);
        assert_eq!(r.metadata_pending.is_empty(), allowed);
        assert_eq!(r.layout_generation, if allowed { 5 } else { 4 });
    }
}
