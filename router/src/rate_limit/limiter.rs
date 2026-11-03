//! In-memory, bounded, all-or-nothing counters.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::counting::Demand;

/// A field that is over its limit for this caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Exceeded {
    pub type_name: String,
    pub field_name: String,
    pub limit: u32,
    pub window_seconds: u64,
    pub retry_after_seconds: u64,
    /// True when this one request wants more than `limit` units, so waiting cannot help.
    pub request_exceeds_limit: bool,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct BucketKey {
    caller: String,
    type_name: String,
    field_name: String,
}

struct Bucket {
    window_start: Instant,
    window: Duration,
    used: u32,
}

impl Bucket {
    fn is_live(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.window_start) < self.window
    }

    fn remaining(&self, now: Instant) -> Duration {
        self.window
            .saturating_sub(now.saturating_duration_since(self.window_start))
    }
}

/// Fixed-window counters keyed by (caller, field), capped at `max_buckets`.
pub struct Limiter {
    max_buckets: usize,
    buckets: Mutex<HashMap<BucketKey, Bucket>>,
}

impl Limiter {
    pub fn new(max_buckets: usize) -> Self {
        Self {
            max_buckets: max_buckets.max(1),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub fn bucket_count(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<BucketKey, Bucket>> {
        // A panic elsewhere must not turn every later request into a panic too.
        self.buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Checks every demand and, only if all fit, records them. If any field is over its
    /// limit nothing is recorded for any field and every exceeded field is returned.
    pub fn check(
        &self,
        caller: &str,
        demands: &[Demand],
        now: Instant,
    ) -> Result<(), Vec<Exceeded>> {
        if demands.is_empty() {
            return Ok(());
        }
        let mut buckets = self.lock();

        let mut exceeded = Vec::new();
        for demand in demands {
            let key = key_for(caller, demand);
            let (used, remaining) = match buckets.get(&key) {
                Some(bucket) if bucket.is_live(now) => (bucket.used, bucket.remaining(now)),
                _ => (0, demand.rule.window),
            };
            if used.saturating_add(demand.units) > demand.rule.limit {
                exceeded.push(Exceeded {
                    type_name: demand.type_name.clone(),
                    field_name: demand.field_name.clone(),
                    limit: demand.rule.limit,
                    window_seconds: demand.rule.window.as_secs(),
                    retry_after_seconds: remaining.as_secs_f64().ceil().max(1.0) as u64,
                    request_exceeds_limit: demand.units > demand.rule.limit,
                });
            }
        }
        if !exceeded.is_empty() {
            return Err(exceeded);
        }

        for demand in demands {
            let key = key_for(caller, demand);
            match buckets.get_mut(&key) {
                Some(bucket) if bucket.is_live(now) => {
                    bucket.used = bucket.used.saturating_add(demand.units);
                }
                existing => {
                    let is_new = existing.is_none();
                    if is_new && buckets.len() >= self.max_buckets {
                        make_room(&mut buckets, self.max_buckets, now);
                    }
                    buckets.insert(
                        key,
                        Bucket {
                            window_start: now,
                            window: demand.rule.window,
                            used: demand.units,
                        },
                    );
                }
            }
        }
        Ok(())
    }
}

fn key_for(caller: &str, demand: &Demand) -> BucketKey {
    BucketKey {
        caller: caller.to_string(),
        type_name: demand.type_name.clone(),
        field_name: demand.field_name.clone(),
    }
}

/// Makes room for one more bucket: drop expired windows first, then evict the live
/// windows that started longest ago until there is a free slot.
fn make_room(buckets: &mut HashMap<BucketKey, Bucket>, max_buckets: usize, now: Instant) {
    buckets.retain(|_, bucket| bucket.is_live(now));
    while buckets.len() >= max_buckets {
        let Some(oldest) = buckets
            .iter()
            .min_by_key(|(_, bucket)| bucket.window_start)
            .map(|(key, _)| key.clone())
        else {
            return;
        };
        buckets.remove(&oldest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rate_limit::rules::Rule;

    fn rule(limit: u32, seconds: u64) -> Rule {
        Rule {
            limit,
            window: Duration::from_secs(seconds),
            cost: 1,
        }
    }

    fn demand(field: &str, units: u32, rule: Rule) -> Demand {
        Demand {
            type_name: "Query".into(),
            field_name: field.into(),
            units,
            rule,
        }
    }

    #[test]
    fn allows_up_to_the_limit_then_rejects() {
        let limiter = Limiter::new(100);
        let now = Instant::now();
        let ask = [demand("products", 1, rule(3, 10))];

        for _ in 0..3 {
            assert!(limiter.check("sub:a", &ask, now).is_ok());
        }
        let exceeded = limiter.check("sub:a", &ask, now).unwrap_err();
        assert_eq!(exceeded.len(), 1);
        assert_eq!(exceeded[0].limit, 3);
        assert_eq!(exceeded[0].window_seconds, 10);
        assert_eq!(exceeded[0].retry_after_seconds, 10);
        assert!(!exceeded[0].request_exceeds_limit);
    }

    #[test]
    fn recovers_once_the_window_has_passed() {
        let limiter = Limiter::new(100);
        let start = Instant::now();
        let ask = [demand("products", 2, rule(2, 10))];

        assert!(limiter.check("sub:a", &ask, start).is_ok());
        assert!(limiter
            .check("sub:a", &ask, start + Duration::from_secs(9))
            .is_err());
        assert!(limiter
            .check("sub:a", &ask, start + Duration::from_secs(10))
            .is_ok());
    }

    #[test]
    fn reports_how_long_until_the_window_resets() {
        let limiter = Limiter::new(100);
        let start = Instant::now();
        let ask = [demand("products", 1, rule(1, 10))];
        limiter.check("sub:a", &ask, start).unwrap();

        let exceeded = limiter
            .check("sub:a", &ask, start + Duration::from_millis(7_500))
            .unwrap_err();
        assert_eq!(exceeded[0].retry_after_seconds, 3);
    }

    #[test]
    fn keeps_callers_apart() {
        let limiter = Limiter::new(100);
        let now = Instant::now();
        let ask = [demand("products", 1, rule(1, 10))];

        assert!(limiter.check("sub:alice", &ask, now).is_ok());
        assert!(limiter.check("sub:alice", &ask, now).is_err());
        assert!(limiter.check("sub:bob", &ask, now).is_ok());
        assert!(limiter.check("ip:10.0.0.1", &ask, now).is_ok());
    }

    #[test]
    fn keeps_fields_apart() {
        let limiter = Limiter::new(100);
        let now = Instant::now();
        assert!(limiter
            .check("sub:a", &[demand("products", 1, rule(1, 10))], now)
            .is_ok());
        assert!(limiter
            .check("sub:a", &[demand("other", 1, rule(1, 10))], now)
            .is_ok());
    }

    #[test]
    fn counts_nothing_when_any_field_in_the_request_is_over() {
        let limiter = Limiter::new(100);
        let now = Instant::now();
        let tight = demand("tight", 1, rule(1, 10));
        let roomy = demand("roomy", 1, rule(10, 10));

        limiter
            .check("sub:a", std::slice::from_ref(&tight), now)
            .unwrap();
        let exceeded = limiter
            .check("sub:a", &[roomy.clone(), tight.clone()], now)
            .unwrap_err();
        assert_eq!(exceeded.len(), 1);
        assert_eq!(exceeded[0].field_name, "tight");

        // `roomy` was not charged by the rejected request: all 10 units are still there.
        let ten_roomy = demand("roomy", 10, rule(10, 10));
        assert!(limiter.check("sub:a", &[ten_roomy], now).is_ok());
    }

    #[test]
    fn reports_every_exceeded_field() {
        let limiter = Limiter::new(100);
        let now = Instant::now();
        let ask = [demand("a", 1, rule(1, 10)), demand("b", 1, rule(1, 10))];
        limiter.check("sub:a", &ask, now).unwrap();
        assert_eq!(limiter.check("sub:a", &ask, now).unwrap_err().len(), 2);
    }

    #[test]
    fn flags_a_request_that_can_never_fit() {
        let limiter = Limiter::new(100);
        let exceeded = limiter
            .check(
                "sub:a",
                &[demand("products", 6, rule(5, 10))],
                Instant::now(),
            )
            .unwrap_err();
        assert!(exceeded[0].request_exceeds_limit);
    }

    #[test]
    fn stays_within_the_bound_and_drops_expired_windows_first() {
        let limiter = Limiter::new(3);
        let start = Instant::now();
        let ask = [demand("products", 1, rule(5, 10))];

        for caller in ["a", "b", "c"] {
            limiter.check(caller, &ask, start).unwrap();
        }
        assert_eq!(limiter.bucket_count(), 3);

        // All three windows have expired, so a new caller pushes them out.
        limiter
            .check("d", &ask, start + Duration::from_secs(11))
            .unwrap();
        assert_eq!(limiter.bucket_count(), 1);
    }

    #[test]
    fn evicts_the_oldest_live_window_when_full_of_live_ones() {
        let limiter = Limiter::new(2);
        let start = Instant::now();
        let ask = [demand("products", 1, rule(1, 100))];

        limiter.check("oldest", &ask, start).unwrap();
        limiter
            .check("newer", &ask, start + Duration::from_secs(1))
            .unwrap();
        limiter
            .check("newest", &ask, start + Duration::from_secs(2))
            .unwrap();
        assert_eq!(limiter.bucket_count(), 2);

        // "oldest" lost its counter (limiter fails open for it); "newer" kept its.
        assert!(limiter
            .check("oldest", &ask, start + Duration::from_secs(3))
            .is_ok());
        assert!(limiter
            .check("newest", &ask, start + Duration::from_secs(3))
            .is_err());
    }
}
