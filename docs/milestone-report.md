# Six-pillar and multi-Actor stress milestone report

The clean implementation executes the semantic-free acceptance lifecycle in LWE-Core. OBJECT_1 moves from LOCATION_1 to LOCATION_2 through the fixture-defined `RelocateObject` Shell Action after the player waits and ACTOR_1 communicates an alternate request to ACTOR_2. The Situation persists across Scenes, resolves through a Consequence, and the movement's WHY trace reaches both communications and the player's Wait. The tests also execute two tiny Shell resolvers with different semantic data without modifying Core.

The multi-Actor stress pass adds one small generic hook for Shell-declared competing attempt groups. Core orders numeric values under Shell-selected direction and tie policy, settles each attempt, and revalidates the next against the resulting objective state. The stress fixtures also cover stale and incomplete Actor Views, three terminal paths, Player/autonomous parity, and seeded weighted desires without adding a gameplay pillar.

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
- `tests/fixtures.js`
- `tests/acceptance.test.js`
- `tests/invariants.test.js`
- `tests/conflicts.test.js`

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

Complete within this milestone: the specified lifecycle and WHY graph; instance isolation; read-only API snapshots; atomic Scene resolution; expected eligibility denial versus visible hook failure; structural World validation; generic state Consequences; explicit information transfer/perception; delayed revalidation and invalidation; causal provenance; serializable budget carryover at completed Scene boundaries; JSON save/restore; manual nested interruption; tests.

Minimal working implementations: universal Actions with fixed Core semantics, including transitive Give and effect-neutral Event-producing Interact; dynamic candidate eligibility; safe autonomous Decision Context projection; desire-weighted arbitration and numeric contest ordering; Situation terminal predicates and expiry; Shell-controlled repeatable importance opportunities; certain/uncertain claims, direct supersession and explicit forgetting; JSON predicates.

Deferred, not falsely presented as complete: migration from nonexistent earlier Core schemas, history compaction/purging, rich retention scheduling, automatic interruption detection, sophisticated Situation evolution policy, richer conflict models, semantic contradiction handling and all genre rules. Terminal paths are structurally required; Core cannot prove that an arbitrary Shell predicate will eventually become true. Use expiry when a finite bound is required.

## D. Selective OGLWE reuse

None. All runtime code was written from the architecture contracts. No legacy implementation was copied or adapted.

## E. Inspected but rejected OGLWE components

None at implementation level. A read-only filename search located the suggested candidate files; their contents were not inspected because this small milestone did not require reuse. Accordingly, no component is claimed to have undergone a compatibility review or to have been rejected after one. The prohibited architectural foundations were not used. OGLWE was not modified.

## F. Dice

Deferred. `packages/dice/README.md` records the intended optional boundary. Core has zero Dice dependencies and all tests run without Dice, AI, UI or external Shell installations.

## G. Tests

Command: `node --test` on the bundled Node runtime. Multi-Actor stress run: **40 passed, 0 failed, 0 skipped**.

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

Exercise save/restore and nested Scene interruption around declared conflicts, without adding semantic initiative or combat policy. A later real-Shell adapter can then validate the generic hook against application needs before Dice is considered.

The requested milestone is a local commit only. No push or external integration is part of this work.
