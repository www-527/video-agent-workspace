# Relay Protocol Resilience — Reflection

- The highest-leverage repair was to model API format as provider connection metadata. Retrying the wrong protocol would only amplify failure.
- `auto` is a deliberate compatibility boundary, not a second owner: it delegates to the previous routing policy until users pin a provider protocol.
- A full CC Switch-style proxy pool, circuit breaker, or provider failover system would exceed the observed need and the application's current one-endpoint-per-key model.
- The added retry branch is justified by transient public-relay behavior and is constrained by attempt count, status classification, abort handling, and tests.
- Future retirement point: when all saved providers have explicit protocol metadata, the legacy `auto` routing policy can be reconsidered as a separate migration.
