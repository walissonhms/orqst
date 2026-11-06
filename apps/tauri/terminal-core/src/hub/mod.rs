//! Lane L4. Port of mcp-hub.ts, mcp-hub-socket.ts, mcp-hub-journal.ts, the mcp-socket.ts
//! framing, mcp-communication.ts and composer-mentions.ts. The Node relay (`mcp-relay.ts`)
//! stays and talks to [`endpoint::open_hub_endpoint`] unchanged.
pub mod communication;
pub mod endpoint;
pub mod framing;
#[allow(clippy::module_inception)]
pub mod hub;
pub mod journal;
pub mod mentions;

pub use endpoint::{open_hub_endpoint, HubEndpoint, TerminalBinding};
pub use hub::{HubError, HubEvidence, HubMember, TerminalMessageHub};
pub use journal::{hub_members, HubActivity, HubJournal, HubSlot};
