//! `@rateLimit`, enforced in the router. Design and trade-offs:
//! docs/decisions/0006-rate-limits.md.

mod counting;
mod limiter;
mod plugin;
mod rules;

pub use plugin::RateLimitPlugin;
