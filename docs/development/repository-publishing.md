# Repository publishing: remote, keys and intermittent SSH authentication — 2026-11-04

This note diagnoses the `origin` remote only. It changes no account, key, remote or
history, and it prints no key material, token or environment. Publishing stays a
separate, explicitly coordinated step.

## Verified facts

- Remote: `origin git@github-walisson:walissonhms/orqst.git`. The alias expands to
  `HostName github.com`, `User git`, `IdentityFile ~/.ssh/id_ed25519`
  (`ssh -G github-walisson`), with the repository host key matching the published
  ED25519 key for `github.com`.
- Account mapping is verified by the server's own greeting:
  `~/.ssh/id_ed25519` → `Hi walissonhms!` , `~/.ssh/id_rsa` → `Hi walissonmr!`.
  The RSA key belongs to a different account with read-only access and must never be
  offered for pushes.
- `ssh.github.com:443` presents three host keys; all three fingerprints
  (`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`,
  `SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM`,
  `SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s`) equal GitHub's official list at
  `https://api.github.com/meta`. Before this change `known_hosts` had **no**
  `[ssh.github.com]:443` entry, so a strict-checking 443 attempt failed at host
  verification; that entry was added from the verified scan
  (`~/.ssh/known_hosts.bak-2026-11-04-695` is the backup).

## Intermittent failure observed

With the correct key, `ssh -T` and `git ls-remote` alternate between success and
`git@github.com: Permission denied (publickey)` for the same command seconds apart:

| Probe                                     | Result                |
| ----------------------------------------- | --------------------- |
| `ssh -T github-walisson` (burst, 8 tries) | 3 success / 5 refused |
| `ssh -T github-walisson` (10 s spacing)   | 1 success / 2 refused |
| `ssh -T github-walisson` (75 s spacing)   | 1 success / 3 refused |
| `id_rsa` → `walissonmr` (6 tries)         | 4 success / 2 refused |
| `-p 443 git@ssh.github.com` (4 tries)     | 2 success / 2 refused |
| `git ls-remote --heads origin` (4 tries)  | 2 success / 2 refused |

Verbose capture of a refusal shows the key offered and the server answering
`SSH2_MSG_USERAUTH_FAILURE` without `PK_OK`, i.e. authentication is rejected before
the server requests a signature;
a successful capture shows `PK_OK` → signed → `SUCCESS`. The failure is identical for
both accounts and both ports, and a coordinated push of an exact SHA by another agent
succeeded in the middle of the same window. These results establish intermittency
and weaken a permanently wrong key/account/permission explanation. They do not
identify the root cause. A GitHub-side condition is a hypothesis; network path,
effective client settings and server-side evidence would need correlation before
attributing the failure to a specific edge. Do not change keys or accounts based
on that hypothesis.

## Local configuration change (evidence-backed)

`~/.ssh/config` now adds `IdentitiesOnly yes` to `Host github-walisson`. Before it, an
agent holding both identities could offer the read-only `id_rsa` for this remote; the
failure mode would look identical (`Permission denied`) but for a different reason.
Nothing else changed: no key was created, registered, removed or copied, no account
switched, the remote URL is unchanged and no history was rewritten.

## Publication protocol

1. Coordinate first; publish only an explicit SHA/refspec, never a moving `HEAD`.
2. Authenticate once and reuse the session (`ControlMaster`), because every extra
   handshake is another chance of an authentication refusal: for example
   `ssh -M -S /tmp/orqst-origin-<pid> -o ControlPersist=600 -fN github-walisson`,
   then `GIT_SSH_COMMAND='ssh -o ControlPath=/tmp/orqst-origin-<pid>'`.
3. Verify `git cat-file -e <sha>^{commit}` and the tag objects locally before sending;
   push the commit and its annotated tag with explicit refspecs.
4. Never `--force`, never push a branch that another agent is moving, and never
   recreate a commit through an API to work around a transport failure.
5. On `Permission denied (publickey)`, retry the same command after a short pause.
   Do not change the remote, keys, account or SSH options in response; a single
   success is not evidence that the intermittency is resolved.

Recorded checks for this note: `ssh -G`, `ssh -T` for both keys, `ssh-keyscan -p 443`
compared with `api.github.com/meta`, repeated `ssh -T`/`git ls-remote` probes, and a
`-vvv` capture of one refusal and one success. No push, tag, fetch refspec change or
credential access was performed from this worktree.
