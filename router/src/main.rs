// Release builds need a deeper limit to lay out the router's nested async server types.
#![recursion_limit = "256"]

mod rate_limit;

use hive_router::{
    configure_global_allocator, error::RouterInitError, init_rustls_crypto_provider,
    router_entrypoint, PluginRegistry, RouterGlobalAllocator,
};

configure_global_allocator!();

#[hive_router::main]
async fn main() -> Result<(), RouterInitError> {
    init_rustls_crypto_provider();

    router_entrypoint(PluginRegistry::new().register::<rate_limit::RateLimitPlugin>()).await
}
