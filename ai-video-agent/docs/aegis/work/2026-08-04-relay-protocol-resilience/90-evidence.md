# Relay Protocol Resilience — Evidence

## Diagnosis

- The failing program trace selected `chat.completions`, attempted once, and received HTTP 502 `Upstream access forbidden`.
- The locally installed CC Switch provider named “蝶祈云公益api” declares `wire_api = "responses"` and `apiFormat = "openai_responses"` for the same relay and model.
- The application previously derived wire protocol from the GPT creative-optimization switch, so diagnostic chat could select Chat even when the provider contract required Responses.

## Change evidence

- `AIKeyStore` schema v6 persists `auto`, `responses`, or `chat.completions` per credential and migrates v1-v5 records to `auto`.
- The diagnostic and production AI request owners share one protocol resolver.
- Explicit Responses and Chat choices operate independently from creative prompt optimization.
- Diagnostic calls retry transient transport/HTTP failures at most three times with abort-aware short backoff; deterministic client errors are not retried.
- In automatic mode, the observed Chat 502 mismatch signature immediately recovers through Responses instead of repeating the incompatible Chat request.
- Final upstream status and sanitized error details remain visible at the route boundary.

## Verification

- Focused persistence/API suites: 18 tests passed.
- Focused diagnostic chat/route suites: 12 tests passed.
- Focused production relay client suite: 19 tests passed.
- Focused Key Management UI suites: 10 tests passed.
- `npx.cmd tsc --noEmit`: passed.
- Full `npm test`: 100 files and 573 tests passed.
- `git diff --check`: passed at closeout (line-ending conversion warnings only).

## Safety and residual risk

- No CC Switch credential, token, or database content was copied into the repository.
- No relay-host-specific routing rule was added; configuration owns the protocol.
- Retries are bounded and limited to transient failures.
- A live request using the user's credential was intentionally not made. A public relay may still independently experience upstream outages, but the final failure is now preserved and diagnosable.
