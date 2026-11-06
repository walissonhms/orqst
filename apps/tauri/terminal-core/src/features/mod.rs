//! Lane L4. Feature, permission, team and layout tables of the private preferences Store
//! (`<preferences>/terminal-layouts/preferences.sqlite`), opened through `crate::store`.
//! Port of feature-configuration.ts, team-database.ts, layout-database.ts and the
//! `@orqst/database` functions they call. Entry point for the Core dispatcher:
//! [`config::dispatch`] with a [`config::FeatureContext`].
pub mod config;
pub mod error;
#[allow(clippy::module_inception)]
pub mod features;
pub mod model;
pub mod permissions;
pub mod store;
pub mod teams;

pub use config::{dispatch, handles, FeatureContext, FEATURE_KINDS};
pub use error::FeatureError;
