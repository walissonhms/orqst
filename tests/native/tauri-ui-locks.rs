// Included twice against the respective actual production State and identity_from functions.
#[test]
fn getter_wait_releases_state_and_rejects_invalidation() {
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    for change in 0..5 {
        let state = Arc::new(Mutex::new(State::default()));
        {
            let mut guard = state.lock().unwrap();
            guard.origin = "http://synthetic.local".into();
            initialize(&mut guard);
        }
        let (started, waiting) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        let task_state = state.clone();
        let worker = std::thread::spawn(move || {
            read(&task_state, || {
                started.send(()).unwrap();
                resumed.recv_timeout(Duration::from_secs(2)).unwrap();
                Some(
                    if change == 4 {
                        "other"
                    } else {
                        "http://synthetic.local/studio"
                    }
                    .into(),
                )
            })
        });
        waiting.recv_timeout(Duration::from_secs(2)).unwrap();
        {
            // Models the UI callback while its getter response is withheld.
            let mut guard = state
                .try_lock()
                .expect("UI callback must acquire state during getter");
            match change {
                1 => invalidate(&mut guard),
                2 => guard.origin = "http://new-document.local".into(),
                3 => {
                    invalidate(&mut guard);
                    invalidate(&mut guard);
                }
                _ => {}
            }
        }
        resume.send(()).unwrap();
        assert_eq!(worker.join().unwrap().is_some(), change == 0);
    }
}
