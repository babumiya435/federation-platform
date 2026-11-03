//! Forwards the router's own request id to every subgraph.
//!
//! The router decides a request's id before plugins run: the client's `x-request-id` if it
//! is usable (short, safe characters), otherwise a generated one. This plugin writes that
//! id back into the request's `x-request-id` header. The `headers.all.request` rule in the
//! router config then propagates the header to every subgraph, so the id in the router's
//! log is the id each subgraph sees, even when the client sent none or an unusable one.

use hive_router::async_trait;
use hive_router::ntex::http::header::{HeaderName, HeaderValue};
use hive_router::plugins::hooks::on_http_request::{
    OnHttpRequestHookFuture, OnHttpRequestHookPayload,
};
use hive_router::plugins::hooks::on_plugin_init::{OnPluginInitPayload, OnPluginInitResult};
use hive_router::plugins::plugin_trait::{RouterPlugin, StartHookPayload};
use hive_router::telemetry::logging::request_id::REQUEST_IDENTIFIERS;

#[derive(Default)]
pub struct RequestIdPlugin;

#[async_trait]
impl RouterPlugin for RequestIdPlugin {
    type Config = ();

    fn plugin_name() -> &'static str {
        "request_id"
    }

    fn on_plugin_init(payload: OnPluginInitPayload<Self>) -> OnPluginInitResult<Self> {
        payload.initialize_plugin_with_defaults()
    }

    fn on_http_request<'req>(
        &'req self,
        mut payload: OnHttpRequestHookPayload<'req>,
    ) -> OnHttpRequestHookFuture<'req> {
        Box::pin(async move {
            // The router's request-id middleware wraps this hook, so its id is in scope.
            let router_id =
                REQUEST_IDENTIFIERS.try_with(|identifiers| identifiers.req_id().to_owned());
            if let Some(value) = router_id
                .ok()
                .and_then(|id| HeaderValue::from_str(&id).ok())
            {
                payload
                    .router_http_request
                    .headers_mut()
                    .insert(HeaderName::from_static("x-request-id"), value);
            }
            payload.proceed()
        })
    }
}
