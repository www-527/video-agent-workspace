# Relay Protocol Resilience — Intent

- Requested outcome: make the saved OpenAI-compatible relay use its declared wire protocol and tolerate bounded transient failures.
- Scope: per-key protocol contract, shared AI routing, diagnostic retries, Key Management UI, focused tests, README.
- Non-goals: importing CC Switch secrets/configuration, building a local proxy, or adding multi-provider failover/circuit breakers.
- Risks: persisted settings migration, retry amplification, abort handling, overlap with existing dirty changes.
- Parent plan: `docs/aegis/plans/2026-08-04-relay-protocol-resilience.md`.
- Required baseline refs: `AGENTS.md`, architecture YAML files, current dirty diff, local CC Switch provider metadata.
- Baseline usage: all required refs acknowledged and cited in the parent plan; none missing.
- Impact: adds one provider connection field and changes protocol selection/retry at existing canonical owners.
- Execution Readiness View: present in the parent plan and aligned; explicit protocol is independent from creative optimization, `auto` preserves compatibility.
