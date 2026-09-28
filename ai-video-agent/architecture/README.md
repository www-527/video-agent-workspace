# Architecture governance

These files configure the architecture rules for this repository. They are the
project-specific layer of `open-code-audit`; keep them aligned with the source
tree rather than changing the generic starter repository.

Before a substantial change, review the changed paths against:

1. `modules.yaml` — module ownership, public paths, and allowed dependencies.
2. `dependency-rules.yaml` — blocking dependency rules.
3. `ownership.yaml` — which module may change each kind of state or contract.
4. `exceptions.yaml` — temporary, time-bounded approved deviations.
5. `quality-budget.yaml` — advisory change-size and complexity limits.

The cloned starter currently supplies configuration templates only; it does not
include an executable analyzer. Treat these files as the source of truth for
manual or agent-assisted reviews until a deterministic import/dependency check
is added.
