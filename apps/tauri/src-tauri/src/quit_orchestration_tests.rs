//! Deterministic integration of the production coordinator, phase lock and ID router.
//! The scripted ports never create an app, process, PTY, provider or native sheet.
use super::*;
use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

#[derive(Clone, Copy)]
enum GateMutation {
    Start,
    Lose,
}

enum Event {
    Quit,
    AgentsAnswer(bool),
    ExitRequested,
    RunOwned,
    Reply(Value),
    Eof,
    Lose,
    Advance(u64),
    StartSelected,
}

#[derive(Default)]
struct Script {
    events: VecDeque<Event>,
    log: Vec<String>,
    pending: PendingReplies,
    next_id: usize,
    sent: Vec<(String, String)>,
    timers: Vec<Duration>,
    now_ms: u64,
    agents: bool,
    authorized: bool,
    reviewing: bool,
    gate_calls: usize,
    gate_mutation: Option<GateMutation>,
    terminal_gate: bool,
    fail_send: bool,
    allowed: usize,
    prevented: usize,
    scheduled: usize,
    admitted: usize,
    refused: usize,
    delivered: Vec<bool>,
    blocked: Vec<(String, Value)>,
}

#[derive(Clone)]
struct FakePorts {
    script: Arc<Mutex<Script>>,
    coordinator: Arc<Coordinator>,
}

impl AgentsGate for FakePorts {
    fn active(&self) -> bool {
        let mut script = self.script.lock().unwrap();
        script.log.push("agents:active".into());
        script.agents
    }

    fn confirm_exit(&self) -> bool {
        let (pending, mutation) = {
            let mut script = self.script.lock().unwrap();
            script.gate_calls += 1;
            script.log.push("agents:gate".into());
            let pending = script.agents && !script.authorized;
            script.reviewing = pending;
            (pending, script.gate_mutation.take())
        };
        match mutation {
            Some(GateMutation::Start) => self.coordinator.host.reserve_start().unwrap(),
            Some(GateMutation::Lose) => self.coordinator.host.lost(),
            None => {}
        }
        pending
    }
}

impl TerminalPipe for FakePorts {
    fn request_id(&self) -> String {
        let mut script = self.script.lock().unwrap();
        script.next_id += 1;
        format!("synthetic-{}", script.next_id)
    }

    fn send(&self, id: &str, kind: &str) -> Option<oneshot::Receiver<Value>> {
        let mut script = self.script.lock().unwrap();
        script.log.push(format!("send:{kind}"));
        script.sent.push((id.into(), kind.into()));
        if script.fail_send {
            return None;
        }
        Some(script.pending.register(id.into()))
    }

    fn cancel(&self, id: &str) {
        let mut script = self.script.lock().unwrap();
        script.pending.cancel(id);
        script.log.push(format!("cancel:{id}"));
    }

    fn confirm_exit(&self) -> bool {
        let mut script = self.script.lock().unwrap();
        script.log.push("terminal:gate".into());
        script.terminal_gate
    }
}

impl ExitPort for FakePorts {
    fn request_exit(&self) {
        let mut script = self.script.lock().unwrap();
        script.log.push("exit:request".into());
        script.events.push_back(Event::ExitRequested);
    }

    fn start_owned_shutdown(&self) {
        let mut script = self.script.lock().unwrap();
        script.scheduled += 1;
        script.events.push_back(Event::RunOwned);
    }

    fn blocked(&self, reason: &str, uncertain: Value) {
        let mut script = self.script.lock().unwrap();
        script.log.push(format!("blocked:{reason}"));
        script.blocked.push((reason.into(), uncertain));
    }

    fn fence(&self) {
        self.script.lock().unwrap().log.push("fence".into());
    }
}

struct ManualWait {
    script: Arc<Mutex<Script>>,
    deadline_ms: u64,
    receiver: oneshot::Receiver<Value>,
}

impl Future for ManualWait {
    type Output = Option<Value>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match Pin::new(&mut self.receiver).poll(cx) {
            Poll::Ready(value) => Poll::Ready(value.ok()),
            Poll::Pending => {
                if self.script.lock().unwrap().now_ms >= self.deadline_ms {
                    Poll::Ready(None)
                } else {
                    Poll::Pending
                }
            }
        }
    }
}

impl Timer for FakePorts {
    fn wait(
        &self,
        duration: Duration,
        receiver: oneshot::Receiver<Value>,
    ) -> impl Future<Output = Option<Value>> + Send {
        let deadline_ms = {
            let mut script = self.script.lock().unwrap();
            script.timers.push(duration);
            script.now_ms + u64::try_from(duration.as_millis()).unwrap()
        };
        ManualWait {
            script: self.script.clone(),
            deadline_ms,
            receiver,
        }
    }
}

type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

struct Harness {
    coordinator: Arc<Coordinator>,
    ports: FakePorts,
    tasks: Vec<Task>,
}

impl Harness {
    fn new(active: bool, agents: bool) -> Self {
        let coordinator = Arc::new(Coordinator::new());
        if active {
            coordinator.host.reserve_start().unwrap();
            coordinator.host.started();
        }
        let ports = FakePorts {
            script: Arc::new(Mutex::new(Script {
                agents,
                ..Script::default()
            })),
            coordinator: coordinator.clone(),
        };
        Self {
            coordinator,
            ports,
            tasks: Vec::new(),
        }
    }

    fn poll_tasks(&mut self) {
        let mut context = Context::from_waker(Waker::noop());
        // One explicit poll per external event. No real timer, sleeps, threads or monitor loop.
        self.tasks
            .retain_mut(|task| task.as_mut().poll(&mut context).is_pending());
    }

    fn dispatch(&mut self, event: Event) {
        match event {
            Event::Quit => self.coordinator.request_quit(&self.ports, &self.ports),
            Event::AgentsAnswer(approved) => {
                {
                    let mut script = self.ports.script.lock().unwrap();
                    assert!(script.reviewing);
                    script.reviewing = false;
                    script.authorized = approved;
                    script.log.push(
                        if approved {
                            "agents:approved"
                        } else {
                            "agents:cancelled"
                        }
                        .into(),
                    );
                }
                if approved {
                    self.coordinator.agents_approved(&self.ports);
                }
            }
            Event::ExitRequested => {
                let allow = self
                    .coordinator
                    .exit_requested(&self.ports, &self.ports, &self.ports);
                let mut script = self.ports.script.lock().unwrap();
                if allow {
                    script.allowed += 1;
                    script.log.push("exit:allowed".into());
                } else {
                    script.prevented += 1;
                    script.log.push("exit:prevented".into());
                }
            }
            Event::RunOwned => {
                let coordinator = self.coordinator.clone();
                let ports = self.ports.clone();
                self.tasks.push(Box::pin(async move {
                    coordinator.quit_owned(&ports, &ports, &ports).await;
                }));
            }
            Event::Reply(value) => {
                let mut script = self.ports.script.lock().unwrap();
                let delivered = script.pending.deliver(value);
                script.delivered.push(delivered);
            }
            Event::Eof => {
                self.ports.script.lock().unwrap().pending = PendingReplies::default();
                self.coordinator.host.lost();
            }
            Event::Lose => self.coordinator.host.lost(),
            Event::Advance(ms) => self.ports.script.lock().unwrap().now_ms += ms,
            Event::StartSelected => {
                // This is the exact shared boundary start_selected must pass before its spawn.
                let admitted = self.coordinator.host.reserve_start().is_ok();
                let mut script = self.ports.script.lock().unwrap();
                if admitted {
                    script.admitted += 1;
                } else {
                    script.refused += 1;
                }
            }
        }
        self.poll_tasks();
    }

    fn drain(&mut self) {
        // Bounded scripted callback queue: every event is causally recorded by a port.
        for _ in 0..128 {
            let event = self.ports.script.lock().unwrap().events.pop_front();
            let Some(event) = event else {
                return;
            };
            self.dispatch(event);
        }
        panic!("scripted callback queue did not settle");
    }

    fn quit(&mut self) {
        self.dispatch(Event::Quit);
        self.drain();
    }

    fn current_id(&self) -> String {
        self.ports
            .script
            .lock()
            .unwrap()
            .sent
            .last()
            .unwrap()
            .0
            .clone()
    }

    fn reply(&mut self, kind: &str, status: &str) {
        self.dispatch(Event::Reply(
            json!({"kind":kind,"id":self.current_id(),"status":status,"uncertain":[]}),
        ));
        self.drain();
    }

    fn sent_kinds(&self) -> Vec<String> {
        self.ports
            .script
            .lock()
            .unwrap()
            .sent
            .iter()
            .map(|(_, kind)| kind.clone())
            .collect()
    }

    fn allowed(&self) -> usize {
        self.ports.script.lock().unwrap().allowed
    }
    fn phase(&self) -> Phase {
        self.coordinator.host.phase()
    }
    fn in_flight(&self) -> bool {
        self.coordinator.in_flight.load(Ordering::SeqCst)
    }
}

#[test]
fn retired_runs_agents_callback_exit_requested_and_owned_flow_in_order_once() {
    let mut h = Harness::new(true, true);
    h.quit();
    assert!(h.sent_kinds().is_empty());
    assert!(!h.in_flight());
    h.dispatch(Event::AgentsAnswer(true));
    h.drain();
    assert_eq!(h.sent_kinds(), ["shutdownOwned"]);
    assert_eq!(h.ports.script.lock().unwrap().prevented, 1);
    h.reply("owned-shutdown", "ready");
    h.reply("retirement", "retired");
    assert_eq!(h.sent_kinds(), ["shutdownOwned", "retireOwned"]);
    assert_eq!(h.allowed(), 1);
    assert_eq!(h.phase(), Phase::ExitConsumed);
    let script = h.ports.script.lock().unwrap();
    let position = |entry: &str| script.log.iter().position(|item| item == entry).unwrap();
    assert!(position("agents:approved") < position("exit:prevented"));
    assert!(position("exit:prevented") < position("send:shutdownOwned"));
    assert!(position("send:shutdownOwned") < position("fence"));
    assert!(position("fence") < position("send:retireOwned"));
    assert!(position("send:retireOwned") < position("exit:allowed"));
}

#[test]
fn preserved_close_requires_closed_and_exits_once() {
    let mut h = Harness::new(true, false);
    h.quit();
    h.reply("owned-shutdown", "exited_retirement_unavailable");
    assert_eq!(h.allowed(), 0);
    h.reply("owned-shutdown-closed", "closed");
    assert_eq!(h.sent_kinds(), ["shutdownOwned", "closePreservedOwned"]);
    assert_eq!(h.allowed(), 1);
    assert_eq!(h.phase(), Phase::ExitConsumed);
    assert!(!h
        .ports
        .script
        .lock()
        .unwrap()
        .log
        .iter()
        .any(|item| item == "fence"));
}

#[test]
fn uncertain_preserves_the_fence_and_the_reported_inventory() {
    let mut h = Harness::new(true, false);
    h.quit();
    let uncertain = json!([{"slot":0,"instanceId":"synthetic-owned","reason":"timeout"}]);
    h.dispatch(Event::Reply(json!({"kind":"owned-shutdown","id":h.current_id(),"status":"uncertain","uncertain":uncertain})));
    h.drain();
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.phase(), Phase::ShutdownInFlight);
    assert!(!h.in_flight());
    assert_eq!(
        h.ports.script.lock().unwrap().blocked,
        [("uncertain".into(), uncertain)]
    );
}

#[test]
fn explicit_prefence_refusal_rolls_back_and_all_other_refusals_keep_the_fence() {
    for status in ["refused_prefence", "busy", "denied", "fenced", "uncertain"] {
        let mut h = Harness::new(true, false);
        h.quit();
        h.reply("owned-shutdown", status);
        assert_eq!(h.allowed(), 0);
        assert_eq!(
            h.phase(),
            if status == "refused_prefence" {
                Phase::Active
            } else {
                Phase::ShutdownInFlight
            }
        );
        assert!(!h.in_flight());
        h.quit();
        assert_eq!(h.sent_kinds(), ["shutdownOwned", "shutdownOwned"]);
    }
}

#[test]
fn the_eight_second_pipe_timeout_keeps_the_fence_and_discards_late_replies() {
    let mut h = Harness::new(true, false);
    h.quit();
    let old_id = h.current_id();
    h.dispatch(Event::Advance(7_999));
    assert!(h.in_flight());
    assert!(h.ports.script.lock().unwrap().blocked.is_empty());
    h.dispatch(Event::Advance(1));
    assert!(!h.in_flight());
    assert_eq!(h.phase(), Phase::ShutdownInFlight);
    assert_eq!(h.allowed(), 0);
    assert_eq!(
        h.ports.script.lock().unwrap().timers,
        [Duration::from_secs(8)]
    );
    h.quit();
    let current_id = h.current_id();
    assert_ne!(old_id, current_id);
    h.dispatch(Event::Reply(
        json!({"kind":"owned-shutdown","id":old_id,"status":"ready"}),
    ));
    assert_eq!(h.sent_kinds(), ["shutdownOwned", "shutdownOwned"]);
    assert_eq!(h.ports.script.lock().unwrap().delivered, [false]);
    h.reply("owned-shutdown", "ready");
    h.reply("retirement", "retired");
    assert_eq!(h.allowed(), 1);
}

#[test]
fn wrong_and_old_ids_and_unrelated_kinds_cannot_resolve_a_waiter() {
    let mut h = Harness::new(true, false);
    h.quit();
    let shutdown_id = h.current_id();
    h.dispatch(Event::Reply(
        json!({"kind":"owned-shutdown","id":"swapped","status":"busy"}),
    ));
    h.dispatch(Event::Reply(
        json!({"kind":"renderer-reply","id":shutdown_id,"status":"ready"}),
    ));
    assert_eq!(h.phase(), Phase::ShutdownInFlight);
    assert!(h.in_flight());
    h.reply("owned-shutdown", "ready");
    h.dispatch(Event::Reply(
        json!({"kind":"retirement","id":shutdown_id,"status":"retired"}),
    ));
    assert_eq!(h.allowed(), 0);
    assert_eq!(
        h.ports.script.lock().unwrap().delivered,
        [false, false, true, false]
    );
    h.reply("retirement", "retired");
    assert_eq!(h.allowed(), 1);
}

#[test]
fn duplicate_quit_schedules_only_one_owned_flow_even_before_its_first_poll() {
    let mut h = Harness::new(true, false);
    h.dispatch(Event::Quit);
    h.dispatch(Event::Quit);
    h.drain();
    h.quit();
    assert_eq!(h.ports.script.lock().unwrap().scheduled, 1);
    assert_eq!(h.sent_kinds(), ["shutdownOwned"]);
    h.reply("owned-shutdown", "ready");
    h.quit();
    assert_eq!(h.sent_kinds(), ["shutdownOwned", "retireOwned"]);
    h.reply("retirement", "retired");
    assert_eq!(h.allowed(), 1);
}

#[test]
fn eof_during_shutdown_cannot_enable_exit_or_open_the_agents_gate() {
    let mut h = Harness::new(true, false);
    h.quit();
    h.dispatch(Event::Eof);
    assert_eq!(h.phase(), Phase::LostUnknown);
    assert_eq!(h.allowed(), 0);
    assert!(!h.in_flight());
    h.ports.script.lock().unwrap().agents = true;
    let gates = h.ports.script.lock().unwrap().gate_calls;
    h.dispatch(Event::ExitRequested);
    h.quit();
    assert_eq!(h.ports.script.lock().unwrap().gate_calls, gates);
    assert_eq!(h.allowed(), 0);
}

#[test]
fn loss_before_authenticated_busy_never_rolls_back_unknown() {
    let mut h = Harness::new(true, false);
    h.quit();
    h.dispatch(Event::Lose);
    h.reply("owned-shutdown", "busy");
    assert_eq!(h.phase(), Phase::LostUnknown);
    assert_eq!(h.allowed(), 0);
}

#[test]
fn a_retirement_reply_after_loss_is_not_exit_evidence() {
    let mut h = Harness::new(true, false);
    h.quit();
    h.reply("owned-shutdown", "ready");
    h.dispatch(Event::Lose);
    h.reply("retirement", "retired");
    assert_eq!(h.phase(), Phase::LostUnknown);
    assert_eq!(h.allowed(), 0);
    assert!(!h.coordinator.host.consume_exit_evidence());
}

#[test]
fn starting_blocks_before_the_agents_dialog() {
    let mut h = Harness::new(false, true);
    h.dispatch(Event::StartSelected);
    h.quit();
    assert_eq!(h.phase(), Phase::Starting);
    assert_eq!(h.ports.script.lock().unwrap().gate_calls, 0);
    assert_eq!(h.ports.script.lock().unwrap().blocked[0].0, "starting");
    assert!(h.sent_kinds().is_empty());
    assert_eq!(h.allowed(), 0);
}

#[test]
fn never_started_exits_directly_and_permanently_closes_admission_before_exit_callback() {
    let mut h = Harness::new(false, false);
    h.dispatch(Event::Quit);
    assert_eq!(h.phase(), Phase::Exiting);
    h.dispatch(Event::StartSelected);
    h.drain();
    assert_eq!(h.allowed(), 1);
    assert_eq!(h.ports.script.lock().unwrap().refused, 1);
    assert_eq!(h.ports.script.lock().unwrap().admitted, 0);
    assert!(h.sent_kinds().is_empty());
}

#[test]
fn lost_unknown_never_opens_an_agents_gate() {
    let mut h = Harness::new(true, true);
    h.dispatch(Event::Eof);
    h.quit();
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.ports.script.lock().unwrap().gate_calls, 0);
    assert_eq!(h.allowed(), 0);
    assert!(h.sent_kinds().is_empty());
}

#[test]
fn cancelling_agents_signals_nothing_and_leaves_the_quit_latch_free() {
    let mut h = Harness::new(true, true);
    h.quit();
    h.dispatch(Event::AgentsAnswer(false));
    h.drain();
    assert_eq!(h.phase(), Phase::Active);
    assert!(!h.in_flight());
    assert_eq!(h.allowed(), 0);
    assert!(h.sent_kinds().is_empty());
    h.quit();
    assert!(h.ports.script.lock().unwrap().reviewing);
    h.dispatch(Event::AgentsAnswer(true));
    h.drain();
    assert_eq!(h.sent_kinds(), ["shutdownOwned"]);
}

#[test]
fn exit_requested_without_evidence_is_prevented_and_runs_the_owned_circuit() {
    let mut h = Harness::new(true, false);
    h.dispatch(Event::ExitRequested);
    h.drain();
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.ports.script.lock().unwrap().prevented, 1);
    assert_eq!(h.sent_kinds(), ["shutdownOwned"]);
}

#[test]
fn consumed_evidence_allows_repeated_exit_but_never_reopens_admission_even_after_eof() {
    let mut h = Harness::new(true, false);
    h.quit();
    h.reply("owned-shutdown", "ready");
    h.reply("retirement", "retired");
    assert_eq!(h.phase(), Phase::ExitConsumed);
    assert!(!h.coordinator.host.consume_exit_evidence());
    h.dispatch(Event::Eof);
    h.dispatch(Event::StartSelected);
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.phase(), Phase::ExitConsumed);
    assert_eq!(h.allowed(), 2);
    assert_eq!(h.ports.script.lock().unwrap().refused, 1);
    assert_eq!(h.ports.script.lock().unwrap().admitted, 0);
    assert_eq!(h.ports.script.lock().unwrap().scheduled, 1);
    assert!(!h.coordinator.host.owned());
}

#[test]
fn eof_between_final_reply_and_exit_requested_preserves_only_confirmed_evidence() {
    for eof_first in [false, true] {
        let mut h = Harness::new(true, false);
        h.quit();
        h.reply("owned-shutdown", "ready");
        if eof_first {
            h.dispatch(Event::Eof);
        }
        h.dispatch(Event::Reply(
            json!({"kind":"retirement","id":h.current_id(),"status":"retired"}),
        ));
        if !eof_first {
            assert_eq!(h.phase(), Phase::ExitEvidenceConfirmed);
            h.dispatch(Event::Eof);
        }
        h.drain();
        assert_eq!(h.allowed(), usize::from(!eof_first));
        assert_eq!(
            h.phase(),
            if eof_first {
                Phase::LostUnknown
            } else {
                Phase::ExitConsumed
            }
        );
    }
}

#[test]
fn start_selected_and_quit_obey_both_orderings_of_the_shared_admission_lock() {
    let mut start_first = Harness::new(false, false);
    start_first.dispatch(Event::StartSelected);
    start_first.quit();
    assert_eq!(start_first.phase(), Phase::Starting);
    assert_eq!(start_first.allowed(), 0);
    assert_eq!(start_first.ports.script.lock().unwrap().admitted, 1);
    start_first.coordinator.host.started();
    start_first.quit();
    assert_eq!(start_first.sent_kinds(), ["shutdownOwned"]);

    let mut quit_first = Harness::new(false, false);
    quit_first.dispatch(Event::Quit);
    quit_first.dispatch(Event::StartSelected);
    quit_first.drain();
    assert_eq!(quit_first.phase(), Phase::Exiting);
    assert_eq!(quit_first.allowed(), 1);
    assert_eq!(quit_first.ports.script.lock().unwrap().admitted, 0);
    assert_eq!(quit_first.ports.script.lock().unwrap().refused, 1);
}

#[test]
fn starting_or_loss_during_the_agents_gate_is_revalidated_before_any_terminal_effect() {
    for mutation in [GateMutation::Start, GateMutation::Lose] {
        let active = matches!(mutation, GateMutation::Lose);
        let mut h = Harness::new(active, true);
        h.ports.script.lock().unwrap().gate_mutation = Some(mutation);
        h.quit();
        assert_eq!(h.ports.script.lock().unwrap().gate_calls, 1);
        assert!(h.sent_kinds().is_empty());
        assert_eq!(h.allowed(), 0);
        assert_eq!(
            h.phase(),
            if active {
                Phase::LostUnknown
            } else {
                Phase::Starting
            }
        );
        assert_eq!(h.ports.script.lock().unwrap().blocked.len(), 1);
        h.dispatch(Event::AgentsAnswer(true));
        h.drain();
        assert!(h.sent_kinds().is_empty());
        assert_eq!(h.allowed(), 0);
    }
}

#[test]
fn final_step_refusal_and_timeout_never_exit_or_release_the_fence() {
    for preserved in [false, true] {
        for timeout in [false, true] {
            let mut h = Harness::new(true, false);
            h.quit();
            h.reply(
                "owned-shutdown",
                if preserved {
                    "exited_retirement_unavailable"
                } else {
                    "ready"
                },
            );
            if timeout {
                h.dispatch(Event::Advance(8_000));
            } else {
                h.reply(
                    if preserved {
                        "owned-shutdown-closed"
                    } else {
                        "retirement"
                    },
                    "denied",
                );
            }
            h.drain();
            assert_eq!(h.allowed(), 0);
            assert_eq!(h.phase(), Phase::ShutdownInFlight);
            assert!(!h.in_flight());
            assert_eq!(h.ports.script.lock().unwrap().blocked.len(), 1);
        }
    }
}

#[test]
fn private_pipe_write_failure_never_starts_a_timer_or_releases_the_fence() {
    let mut h = Harness::new(true, false);
    h.ports.script.lock().unwrap().fail_send = true;
    h.quit();
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.phase(), Phase::ShutdownInFlight);
    assert!(!h.in_flight());
    assert!(h.ports.script.lock().unwrap().timers.is_empty());
    assert_eq!(h.ports.script.lock().unwrap().blocked[0].0, "transport");
}

#[test]
fn no_owned_host_keeps_the_existing_terminal_then_agents_gate_order() {
    let mut h = Harness::new(false, true);
    h.ports.script.lock().unwrap().terminal_gate = true;
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.ports.script.lock().unwrap().gate_calls, 0);
    h.ports.script.lock().unwrap().terminal_gate = false;
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.ports.script.lock().unwrap().gate_calls, 1);
}

#[test]
fn direct_exit_requested_also_reserves_admission_without_a_prior_quit_call() {
    let mut h = Harness::new(false, false);
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.allowed(), 1);
    assert_eq!(h.phase(), Phase::Exiting);
    h.dispatch(Event::StartSelected);
    assert_eq!(h.ports.script.lock().unwrap().refused, 1);
}

#[test]
fn a_start_during_the_legacy_agents_check_cannot_cross_a_direct_exit_requested() {
    let mut h = Harness::new(false, false);
    h.ports.script.lock().unwrap().gate_mutation = Some(GateMutation::Start);
    h.dispatch(Event::ExitRequested);
    assert_eq!(h.allowed(), 0);
    assert_eq!(h.phase(), Phase::Starting);
    assert!(h.sent_kinds().is_empty());
}

#[test]
fn real_node_service_transcripts_keep_the_coordinator_fenced() {
    let Ok(path) = std::env::var("ORQST_QUIT_NODE_TRANSCRIPT") else {
        // Cross-language run explicitly supplies the current real-service artifact.
        return;
    };
    let transcripts: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(transcripts.as_array().unwrap().len(), 2);
    for transcript in transcripts.as_array().unwrap() {
        assert_eq!(transcript["nodeFenced"], true);
        assert_eq!(transcript["signals"], 1);
        let mut h = Harness::new(true, false);
        h.quit();
        let mut ready = transcript["ready"].clone();
        ready["id"] = json!(h.current_id());
        h.dispatch(Event::Reply(ready));
        h.drain();
        assert_eq!(h.sent_kinds(), ["shutdownOwned", "retireOwned"]);
        h.dispatch(Event::Advance(8_000));
        assert_eq!(h.phase(), Phase::ShutdownInFlight);
        h.quit();
        let mut busy = transcript["busyRetry"].clone();
        busy["id"] = json!(h.current_id());
        h.dispatch(Event::Reply(busy));
        assert_eq!(h.phase(), Phase::ShutdownInFlight);
        assert_eq!(h.allowed(), 0);
        if transcript["hold"] == "retire" {
            h.quit();
            let mut retry = transcript["retry"].clone();
            retry["id"] = json!(h.current_id());
            h.dispatch(Event::Reply(retry));
            assert_eq!(h.phase(), Phase::ShutdownInFlight);
            assert_eq!(h.allowed(), 0);
        }
        // A late denied retirement ACK cannot consume a new shutdown waiter.
        h.dispatch(Event::Reply(transcript["denied"].clone()));
        assert_eq!(h.phase(), Phase::ShutdownInFlight);
    }
}
