# Six-pillar Core and optional Dice milestone report

The clean implementation executes the semantic-free acceptance lifecycle in LWE-Core. OBJECT_1 moves from LOCATION_1 to LOCATION_2 through the fixture-defined `RelocateObject` Shell Action after the player waits and ACTOR_1 communicates an alternate request to ACTOR_2. The Situation persists across Scenes, resolves through a Consequence, and the movement's WHY trace reaches both communications and the player's Wait. The tests also execute two tiny Shell resolvers with different semantic data without modifying Core.

The multi-Actor stress pass adds one small generic hook for Shell-declared competing attempt groups. Core orders numeric values under Shell-selected direction and tie policy, settles each attempt, and revalidates the next against the resulting objective state. The stress fixtures also cover stale and incomplete Actor Views, three terminal paths, Player/autonomous parity, and seeded weighted desires without adding a gameplay pillar.

The lifecycle-integrity pass serializes future Action batches at safe checkpoints and preserves deterministic conflict resolution across restoration. Nested Scene Consequences now remain causal inputs when a parent resumes, while ending a parent produces explicit cancellation Events. Partial conflict resolution remains inside one atomic, unsaveable Scene transaction.

The optional Dice pass adds a standalone ESM package for expressions, caller modifiers, target checks, neutral candidate selection, opposed sides, caller-defined classification, and serializable seeded RNG state. Shell integration tests bridge its numeric results into ordinary Actions and conflicts while mandatory Core remains dependency-free.

## A. Files created or changed

The root README is maintained as the repository entry point and links to the authoritative records, implementation contract, usage guide, report, and acceptance tests.

Created:

- `package.json`
- `docs/implementation-contracts.md`
- `docs/getting-started.md`
- `docs/milestone-report.md`
- `src/api/index.js`
- `src/core/world-state/index.js`
- `src/core/actors-actions/index.js`
- `src/core/information/index.js`
- `src/core/situations/index.js`
- `src/core/events-consequences/index.js`
- `src/core/scene-progression/index.js`
- `src/infrastructure/records.js`
- `src/infrastructure/rules/index.js`
- `src/infrastructure/persistence/index.js`
- `packages/dice/README.md`
- `packages/dice/index.js`
- `packages/dice/package.json`
- `tests/fixtures.js`
- `tests/acceptance.test.js`
- `tests/invariants.test.js`
- `tests/conflicts.test.js`
- `tests/lifecycle-conflicts.test.js`
- `tests/dice.test.js`

The authoritative Word architecture files were read and not modified. No files outside LWE-Core were changed.

## B. Pillar mapping

| Pillar | Module |
| --- | --- |
| World State | `src/core/world-state/index.js` |
| Actors + Actions | `src/core/actors-actions/index.js` |
| Information | `src/core/information/index.js` |
| Situations | `src/core/situations/index.js` |
| Events + Consequences | `src/core/events-consequences/index.js` |
| Scene Progression | `src/core/scene-progression/index.js` |

The public API and infrastructure files support these six responsibilities; none is an additional gameplay pillar.

## C. Complete for this pass versus minimal or deferred

Complete within this milestone: the specified lifecycle and WHY graph; instance isolation; read-only API snapshots; atomic Scene resolution; expected eligibility denial versus visible hook failure; structural World validation; generic state Consequences; explicit information transfer/perception; delayed revalidation and invalidation; causal provenance; serializable Consequence and future-Action carryover at completed Scene boundaries; deterministic JSON save/restore; nested interruption with explicit resume, transform, and cancellation behavior; tests.

Minimal working implementations: universal Actions with fixed Core semantics, including transitive Give and effect-neutral Event-producing Interact; dynamic candidate eligibility; safe autonomous Decision Context projection; desire-weighted arbitration and numeric contest ordering; Situation terminal predicates and expiry; Shell-controlled repeatable importance opportunities; certain/uncertain claims, direct supersession and explicit forgetting; JSON predicates.

Deferred, not falsely presented as complete: migration from nonexistent earlier Core schemas, history compaction/purging, rich retention scheduling, automatic interruption detection, sophisticated Situation evolution policy, richer conflict models, semantic contradiction handling and all genre rules. Terminal paths are structurally required; Core cannot prove that an arbitrary Shell predicate will eventually become true. Use expiry when a finite bound is required.

## D. Selective OGLWE reuse

The review was limited to the isolated `OGLWE/www/js/lwe_dice.js`. Its expression grammar, numeric limits, safe arithmetic, injected-RNG validation, candidate-roll structure, and caller-defined classification were suitable foundations for the optional package. They were adapted to a small ESM API with neutral keep policies, a numeric modifier, selectable comparisons, opposed sides, and serializable seeded RNG state. No six-pillar runtime code was reused.

## E. Inspected but rejected OGLWE components

From `lwe_dice.js`, the UMD/CommonJS/global wrapper, verbose cloned error details, sourced modifier records, and outcome-policy callback were unnecessary for the new boundary. The legacy file contained no game-specific UI, Scene, named-stat, or fictional target logic to reject. Kisaragi `dice.js` was not inspected or reused. OGLWE was not modified.

## F. Dice

Implemented as optional infrastructure under `packages/dice/`. Core has zero Dice imports and continues to run independently. Dice owns only numeric/random resolution; Shells own modifiers, target meaning, Action outcomes, and persistence of any Dice RNG snapshot beside the Core save envelope.

## G. Tests

Command: `node --test` on the bundled Node runtime. Optional Dice run: **56 passed, 0 failed, 0 skipped**.

Coverage includes the acceptance lifecycle; fixture-defined object relocation; two small Shell adapters; invalid IDs/references/data/containment; frozen snapshots and hooks; rollback; delayed valid and stale work; false claims and lineage; forgetting independent of history; awareness and evidence guards; safe autonomous Decision Context contents; desire-weighted autonomous selection; explicit off-screen authorization; hidden Situation expiry and legitimate repeated opportunity content; causal budgets and depth safety; multiple causes; universal Actor-only Move, nested Give, and effect-neutral Interact with downstream Shell Consequences; competing Actions with immediate revalidation; deterministic, seeded-random, no-winner, and compatible-simultaneous ties; stale and incomplete Views; three Situation paths; Player/autonomous parity; weighted selection; nested Scenes; save version/reference validation; deterministic restoration with already-due queued work; re-entry; creation, retirement, Relations and Globals; post-effect perception; dynamic availability; visible eligibility hook failures; and checkpoint safety when a final budgeted effect satisfies a Situation.

## H. Architecture deviations

No intentional ownership or pillar deviations. The scope is a minimum implementation, with the omissions in C. Core Contracts v1's explicit Event/Consequence rule takes precedence over the earlier overview's shorthand wording about Actions applying effects.

Persistent world records use Entities, while Relations/Globals and scene-control envelope fields follow the specific exceptions described in the architecture. Public history queries expose objective records and are for trusted Shell adjudication/diagnostics, not autonomous choice input.

## I. Architectural uncertainty and resolved choices

- The documents do not mandate a language or Entity component schema. This pass uses plain ESM JavaScript and structural components in one Entity registry.
- The important-Situation awareness guarantee requires legitimate Shell information. This pass requires a concrete disclosure path at registration and delivers only that claim; Core cannot determine fictional legitimacy itself.
- A declared terminal path does not establish eventual reachability. Predicate paths and optional finite expiry are supported without pretending to prove arbitrary Shell policy.
- Shell causal budgets can leave work pending. A completed Scene boundary remains a safe checkpoint because the exact queue and deterministic control state are serialized; active and suspended Scene transactions remain unsavable.
- Autonomous callbacks receive no objective world data. Shell callbacks are trusted code, so Core cannot prevent a Shell closure from obtaining truth elsewhere; the API contract forbids using such an escape for decision-making. Explicit Situation targets and evidence are checked independently.
- Scene boundaries are numeric control indices, not fictional elapsed time. Fictional calendars must be ordinary Shell-defined World data changed through Consequences.

## J. Recommended next step

The original recommendation to build a small HearthVale adapter has now been validated externally through HearthVale commit `1d94134`. Its separate 29-test suite passes against this Core baseline. No HearthVale implementation belongs in this repository. Core is now v0.1.0 — Six-Pillar Foundation; see the [release changelog](../CHANGELOG.md). Further Core functionality requires a separately approved milestone.

The requested milestone is a local commit only. No push or external integration is part of this work.
