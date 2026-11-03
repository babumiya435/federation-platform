use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;

use hive_router::async_trait;
use hive_router::executor::execution::client_request_details::JwtRequestDetails;
use hive_router::executor::execution::plan::FailedExecutionResult;
use hive_router::http::StatusCode;
use hive_router::plugins::hooks::on_graphql_analysis::{
    OnGraphqlAnalysisHookPayload, OnGraphqlAnalysisHookResult,
};
use hive_router::plugins::hooks::on_http_request::{
    OnHttpRequestHookFuture, OnHttpRequestHookPayload,
};
use hive_router::plugins::hooks::on_plugin_init::{OnPluginInitPayload, OnPluginInitResult};
use hive_router::plugins::hooks::on_supergraph_load::{
    OnSupergraphLoadStartHookPayload, OnSupergraphLoadStartHookResult,
};
use hive_router::plugins::plugin_trait::{EndHookPayload, RouterPlugin, StartHookPayload};
use hive_router::sonic_rs::{json, JsonValueTrait};
use hive_router::tracing::{info, warn};
use hive_router::{ArcSwap, GraphQLError, PlanExecutionOutput};
use serde::Deserialize;

use super::counting::demands;
use super::limiter::{Exceeded, Limiter};
use super::rules::{RuleSet, DIRECTIVE_NAME};

#[derive(Deserialize)]
#[serde(default)]
pub struct RateLimitConfig {
    /// Most (caller, field) counters kept in memory at once.
    pub max_buckets: usize,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_buckets: 10_000,
        }
    }
}

/// The peer address of the TCP connection, captured when the HTTP request arrives and
/// read back in the analysis hook. Never taken from forwarded-for headers.
struct PeerAddress(Option<IpAddr>);

pub struct RateLimitPlugin {
    rules: ArcSwap<RuleSet>,
    limiter: Limiter,
}

/// Valid token with a `sub` claim -> that subject; anything else -> the peer address.
fn caller_id(subject: Option<&str>, peer: Option<IpAddr>) -> String {
    match (subject, peer) {
        (Some(subject), _) => format!("sub:{subject}"),
        (None, Some(address)) => format!("ip:{address}"),
        (None, None) => "ip:unknown".to_string(),
    }
}

fn rejection(exceeded: &[Exceeded]) -> PlanExecutionOutput {
    let errors: Vec<GraphQLError> = exceeded
        .iter()
        .map(|item| {
            let field = format!("{}.{}", item.type_name, item.field_name);
            let detail = if item.request_exceeds_limit {
                format!(
                    "this request uses more than the {} allowed per {}s",
                    item.limit, item.window_seconds
                )
            } else {
                format!("{} per {}s", item.limit, item.window_seconds)
            };
            let mut error = GraphQLError::from_message_and_code(
                format!("Rate limit exceeded for {field}: {detail}."),
                "RATE_LIMITED",
            );
            error.extensions.extensions.extend([
                ("field".to_string(), json!(field)),
                ("limit".to_string(), json!(item.limit)),
                ("windowSeconds".to_string(), json!(item.window_seconds)),
                (
                    "retryAfterSeconds".to_string(),
                    json!(item.retry_after_seconds),
                ),
            ]);
            error
        })
        .collect();

    PlanExecutionOutput {
        error_count: errors.len(),
        body: FailedExecutionResult { errors }.serialize(),
        status_code: StatusCode::TOO_MANY_REQUESTS,
    }
}

#[async_trait]
impl RouterPlugin for RateLimitPlugin {
    type Config = RateLimitConfig;

    fn plugin_name() -> &'static str {
        "rate_limit"
    }

    fn on_plugin_init(payload: OnPluginInitPayload<Self>) -> OnPluginInitResult<Self> {
        let max_buckets = payload.config()?.max_buckets;
        payload.initialize_plugin(Self {
            rules: ArcSwap::from_pointee(RuleSet::default()),
            limiter: Limiter::new(max_buckets),
        })
    }

    fn on_http_request<'req>(
        &'req self,
        payload: OnHttpRequestHookPayload<'req>,
    ) -> OnHttpRequestHookFuture<'req> {
        Box::pin(async move {
            let peer = payload
                .router_http_request
                .peer_addr()
                .map(|address| address.ip());
            payload.context.insert(PeerAddress(peer));
            payload.proceed()
        })
    }

    /// Reads the limits out of every supergraph the router loads. They only replace the
    /// current ones once the router has finished building that supergraph, and a bad
    /// directive fails the load so the previous supergraph stays in service.
    fn on_supergraph_reload<'exec>(
        &'exec self,
        start_payload: OnSupergraphLoadStartHookPayload,
    ) -> OnSupergraphLoadStartHookResult<'exec> {
        match RuleSet::from_document(&start_payload.new_ast) {
            Ok(rules) => start_payload.on_end(move |end_payload| {
                info!(
                    limits = rules.len(),
                    "rate_limit: loaded @{DIRECTIVE_NAME} rules from the supergraph"
                );
                self.rules.store(Arc::new(rules));
                end_payload.proceed()
            }),
            Err(problems) => {
                warn!(
                    ?problems,
                    "rate_limit: rejecting supergraph with invalid @{DIRECTIVE_NAME}"
                );
                start_payload.end_with_graphql_error(
                    GraphQLError::from_message_and_code(
                        format!("Invalid @{DIRECTIVE_NAME}: {}", problems.join("; ")),
                        "INVALID_RATE_LIMIT_DIRECTIVE",
                    ),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            }
        }
    }

    /// Runs after validation and before query planning, so a rejected request never
    /// reaches a subgraph.
    async fn on_graphql_analysis<'exec>(
        &'exec self,
        payload: &mut OnGraphqlAnalysisHookPayload<'exec>,
    ) -> OnGraphqlAnalysisHookResult {
        let rules = self.rules.load();
        if rules.is_empty() {
            return OnGraphqlAnalysisHookResult::Proceed;
        }

        let operation = payload.filtered_operation_for_plan;
        let root_type = rules.root_type(operation.operation_kind.as_ref());
        let wanted = demands(&operation.selection_set, root_type, &rules);
        if wanted.is_empty() {
            return OnGraphqlAnalysisHookResult::Proceed;
        }

        let subject = match payload.client_request_details.jwt.as_ref() {
            JwtRequestDetails::Authenticated { claims, .. } => claims
                .get("sub")
                .and_then(|value| value.as_str())
                .map(str::to_owned),
            _ => None,
        };
        let peer = payload
            .context
            .get_ref::<PeerAddress>()
            .and_then(|entry| entry.0);
        let caller = caller_id(subject.as_deref(), peer);

        match self.limiter.check(&caller, &wanted, Instant::now()) {
            Ok(()) => OnGraphqlAnalysisHookResult::Proceed,
            Err(exceeded) => {
                info!(caller = %caller, fields = exceeded.len(), "rate_limit: request rejected");
                OnGraphqlAnalysisHookResult::EndWithResponse(rejection(&exceeded))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_authenticated_callers_by_subject_and_others_by_address() {
        let address: IpAddr = "203.0.113.7".parse().unwrap();
        assert_eq!(caller_id(Some("alice"), Some(address)), "sub:alice");
        assert_eq!(caller_id(None, Some(address)), "ip:203.0.113.7");
        assert_eq!(caller_id(None, None), "ip:unknown");
    }

    #[test]
    fn rejection_is_a_429_with_one_coded_error_per_field() {
        let exceeded = vec![Exceeded {
            type_name: "Query".into(),
            field_name: "products".into(),
            limit: 5,
            window_seconds: 10,
            retry_after_seconds: 7,
            request_exceeds_limit: false,
        }];
        let output = rejection(&exceeded);
        assert_eq!(output.status_code, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(output.error_count, 1);

        let body: serde_json::Value = serde_json::from_slice(&output.body).unwrap();
        assert!(body.get("data").is_none());
        let error = &body["errors"][0];
        assert_eq!(
            error["message"],
            "Rate limit exceeded for Query.products: 5 per 10s."
        );
        assert_eq!(error["extensions"]["code"], "RATE_LIMITED");
        assert_eq!(error["extensions"]["field"], "Query.products");
        assert_eq!(error["extensions"]["limit"], 5);
        assert_eq!(error["extensions"]["windowSeconds"], 10);
        assert_eq!(error["extensions"]["retryAfterSeconds"], 7);
    }
}
