# Changelog

## 0.1.0 — Six-Pillar Foundation — 2026-09-09

Initial-development baseline for Living World Engine Core. The six-pillar architecture is locked for this release; the API is not a stable 1.0 contract.

- World State: generic Entities, locations, nested containment, Relations, Globals, and structural validation.
- Actors + Actions: shared Human/Autonomous attempts, fixed universal Actions, Shell extensions, safe local decision context, and generic weighted arbitration.
- Information: Actor-local claims, explicit perception and communication, provenance, supersession, and forgetting independent of history.
- Situations: world-owned lifecycle, multiple terminal paths, and legitimate repeatable opportunities under Shell policy.
- Events + Consequences: structural effects, delayed/deferred causal work, history, and causal WHY queries.
- Scene Progression: atomic resolution, off-screen budgets, nested interruption, resume/transform/end, and lifecycle continuity.
- Multi-Actor conflict ordering, revalidation, explicit tie policies, and deferred attempts.
- Deterministic save/restore at safe boundaries, including queued work and Core RNG state. JSON save format remains version 1; Shell functions are supplied again on restore.
- Optional Dice package for neutral numeric checks, contests, and separately persisted Shell-owned RNG state. Dice is not a seventh pillar or a mandatory Core dependency.
- External validation by the separate HearthVale playable Shell, including combat. HearthVale implementation and tests are not included in this release.

Validation: 56 Core tests and 29 separate HearthVale consumer tests pass. Deferred work includes history compaction, rich retention policies, automatic interruption detection, richer conflict models, and semantic game systems. No prior public save-format migrations are introduced.
