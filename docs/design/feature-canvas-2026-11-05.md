# Owner-directed Feature canvas — 2026-11-05

The owner replaced the tab-strip-only interpretation with an orchestration canvas
reference, relayed by pane-768 to pane-817 on this date. This dated amendment changes
the approved V6 presentation; the five original Markdown files and HTML remain intact.
The supplied image is a visual requirement, never runtime data or a source license.

Use a dark dotted Feature canvas, framed metadata groups, agent summary cards,
orthogonal evidenced links, a floating zoom/pan/fit toolbar and a minimap. Keep the
ORQST identity, Feature tabs, collapsible Needs you/Running/Recent sidebar and status
bar. Unknown owned terminals have their own sidebar section rather than a fabricated
running/recent state. Search and New session expose Command-K/Command-N.

Cards contain only explicitly bound sessions/events. Missing activity, agent state,
effective model and observed interval are unavailable. Process running does not
establish an agent turn. Explicit validated parentage events in the same Feature
and Workspace are required for links; prose never supplies parentage. An orchestrator
label is descriptive metadata and grants nothing.

Selecting a card opens its retained real native terminal view. Native PTY Webviews
remain outside the transformed DOM. Canvas navigation revokes input, does not stop
or terminate a process and does not rewrite minimized preferences. The visible
Canvas button always returns; Escape returns when terminal keyboard authority is
disabled, preserving CLI Escape while input is enabled.

The current terminal metadata facade does not expose an explicit owned CLI-session
binding or event stream. Therefore production cards currently display unavailable
agent activity/model/duration and draw no links. The source-backed display components
are separately exercised with labelled synthetic evidence in an opt-in renderer
script; those fixtures are not production data. This increment does not implement
MCP communication, mentions, delegation, role/group editing or provider orchestration.

See [research](../research/feature-canvas.md) and
[verification and native acceptance](../development/feature-canvas.md).
