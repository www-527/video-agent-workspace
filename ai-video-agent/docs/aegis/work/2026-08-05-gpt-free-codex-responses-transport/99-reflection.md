# Reflection — GPT 自由创作 Codex Responses 迁移

## What changed

The implementation replaced a workflow-wide assumption (“GPT-free should force the broadly compatible Chat path”) with an explicit request-level transport policy. The shared AI API remains stable for callers, while the Codex-specific wire contract has one owner and two purpose-specific adapters.

## Important finding

`AsyncLocalStorage.enterWith()` called after an awaited binding helper did not reliably replace the caller continuation's store. The repair was to mutate the request-owned context object, which is safe because `withAIKeyRoute` creates a distinct object for each request. Concurrency tests demonstrate that project Key/model/policy changes remain isolated.

## Complexity and retirement

- Complexity delta: one policy discriminator, one shared wire core and one production adapter were added; duplicated wire parsing was avoided.
- Old GPT-free path: retired at the shared AI client boundary by routing before SDK construction and relay fallback state.
- Retained path: the older retry/fallback machinery remains canonical for default-policy work and is covered by existing regression tests.
- No new fallback was introduced.

## Drift check

- Original intent: aligned.
- Approved transport fields and one-request semantics: aligned.
- Existing Agent prompts and business return shapes: aligned.
- Test dialog isolation: aligned.
- Standard/DeepSeek/legacy compatibility boundary: aligned.
- Source-of-truth or persistence changes: none.

## ADR backfill result

ADR creation was skipped because the change is localized and reversible; it fails the hard-to-reverse gate. The accepted design, plan, protocol ownership table, README and evidence bundle are the lighter durable memory.

## Completion state

Implementation and local verification are complete. The work remains in the user's existing dirty branch/worktree; no staging, commit, push, merge or cleanup was authorized or performed.
