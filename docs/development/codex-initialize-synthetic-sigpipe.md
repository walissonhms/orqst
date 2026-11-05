# Synthetic Codex initialize SIGPIPE — 2026-11-05

The first full `pnpm test` at `ebb64adf1d3faf7592c0babf5e40b07e1cd35e5d`
failed in `tests/codex-native-initialize.test.ts`, at the compatible-child exit
assertion. It expected `{code:null, signal:'SIGTERM'}` and observed
`{code:null, signal:'SIGPIPE'}`. The focused retry and a second complete suite
passed. The failure output does not identify which compatible scenario failed;
the final assertion is in `finally` and can mask an earlier error.

The test's `stderr-error` injection destroys the native child's stderr pipe in
`setImmediate`. The synthetic C fixture writes to stderr immediately after
startup. A separate reproduction compiled the exact fixture, spawned it 24
times with a synthetic `compatible` cwd, immediately destroyed the stderr
reader, drained stdout and ended stdin: all 24 children exited by `SIGPIPE`.
This proves a closed-pipe race can produce the observed signal. It does not
prove that particular scenario caused the original failure: the failure log
did not preserve the mode or a causal pipe trace, and stdout is another pipe.
No real provider or session was used.

The test was not weakened or altered for packaging. A follow-up fix should
preserve coverage of the host's stderr read-error handling while separating
the injected read error from child pipe closure, and retain the actual observed
exit receipt instead of replacing it with an assumed signal. It needs its own
tests and independent review; passing retries do not erase the first failure.
