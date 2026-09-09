# Living World Engine Core

A small, dependency-free implementation of the six LWE Core pillars. Core owns structure and generic resolution; Shell owns meaning. The authoritative architecture is in the two Word documents under `docs/`.

This is the first contract milestone, not a complete game engine. It has no Dice, AI, browser, UI, or named-Shell dependency.

## Run

Use Node.js 22 or later. No dependency installation is needed.

```sh
node --test
```

`npm test` invokes the same command.

## Public API

Import from `src/api/index.js`. Internal modules are implementation details; Shells must not call their mutators.

```js
import { createRuntime } from './src/api/index.js';

const runtime = createRuntime({
  entities: [
    { id: 'ACTOR_PLAYER', actor: { controller: 'Human' } },
    { id: 'OBJECT_1', primaryLocation: 'LOCATION_1' },
    { id: 'LOCATION_1' },
    { id: 'LOCATION_2' },
  ],
});

runtime.startScene({ participants: ['ACTOR_PLAYER'] });
runtime.submit({
  actor: 'ACTOR_PLAYER', type: 'Move', targets: ['OBJECT_1'],
  params: { location: 'LOCATION_2' },
});
// OBJECT_1 remains at LOCATION_1 until the Scene resolves.
runtime.resolveScene();
console.log(runtime.entity('OBJECT_1').primaryLocation); // LOCATION_2
console.log(runtime.why('OBJECT_1', 'primaryLocation'));
const restored = createRuntime({ saved: runtime.save() });
```

Snapshots, Entity reads, Views, history, and traces are detached and deeply frozen. `submit` queues input. Only `resolveScene` advances the boundary and applies world effects. A failed hook or structural error rolls the complete boundary back; an ineligible Action produces an objective failed Event. Shell hooks are synchronous, trusted application code, not sandboxed plugins. Hooks must not retain another path to runtime truth for autonomous decision-making or perform external side effects that Core cannot roll back.

| API | Purpose |
| --- | --- |
| `entity(id)`, `snapshot()` | Objective, read-only inspection |
| `view(actor)` | Active claims available to that Actor |
| `available(actor)` | Dynamic Shell candidates filtered through Action eligibility |
| `startScene(context)`, `submit(attempt)` | Open a window and queue attempts |
| `resolveScene({budget, offscreenBudget})` | Advance one window; default budgets are 1,000 causal operations and zero off-screen Actions |
| `interrupt(context)`, `resume(mode, context)` | Nested Scene interruption; mode is `resume`, `transform`, or `end` |
| `history()`, `trace(recordId)`, `why(entityId, field)` | Objective causal records and explanations |
| `save()` | Versioned JSON at a stable checkpoint |

Saved control state includes pending delayed Consequences and deterministic random state. Supply the Shell again on restore; functions are not serialized. Unknown save versions are rejected explicitly. Queued due work carries across windows when its budget is exhausted, and saving remains blocked until it stabilizes. Advance large skips by repeating Scene windows. There is no background timer.

## Six modules

| Pillar | Module | Responsibility |
| --- | --- | --- |
| World State | `src/core/world-state/index.js` | Entity registry, structural validation, locations, nested containment, Relations, Globals |
| Actors + Actions | `src/core/actors-actions/index.js` | Common Human/Autonomous attempts, eligibility, universal and Shell Actions |
| Information | `src/core/information/index.js` | Actor claims, sources, lineage, supersession and forgetting |
| Situations | `src/core/situations/index.js` | Persistent lifecycle, terminal predicates, expiry, importance opportunities |
| Events + Consequences | `src/core/events-consequences/index.js` | Event records, effects, delayed validation, causal queue and WHY |
| Scene Progression | `src/core/scene-progression/index.js` | Single heartbeat, stage ordering, budgets, off-screen decisions, interruptions and checkpoints |

Rules, JSON record helpers, persistence, and the public API are supporting infrastructure. `packages/dice/` documents the deferred optional package; Core has no import from it.

## Shell contract

See [implementation contracts](implementation-contracts.md) for the decisions taken before implementation. [The acceptance fixture](../tests/fixtures.js) demonstrates communication, local decisions, explicit perception, Situation resolution and the later alternate response. [The acceptance test](../tests/acceptance.test.js) verifies the causal trace and two additional tiny Shell adapters.

Universal Actions are `Move`, `Take`, `Give`, `Communicate`, `Interact`, and `Wait`. Move defaults to the Actor when no Entity target is specified. Give accepts `[possessedEntity, receiver]`. Communicate accepts recipient targets and `params.claim`. Wait and Interact have no default world effect; Shell can override any universal resolver or forbid it through eligibility.

An Action can include a `situation` reference and current claim IDs in `evidence`. Core requires Situation awareness and validates that evidence belongs to the acting Actor. Autonomous `choices` receives only Actor identity, local View and the boundary number. Objective state is supplied separately to adjudication and world-process hooks. Shell authors remain responsible for using View contents to formulate meaningful decisions, including belief-based targeting outside the explicit Situation guard.

Effects carry a generic operation plus optional `due` (absolute progression boundary) and `when` (JSON predicate). Operations include `create`, `retire`, `move`, `contain`, `data`, `relation`, `global`, `learn`, `forget`, `situation`, and `emit`. Event perception runs after immediate structural effects; presence alone grants nothing. Use explicit later Events when perception of a delayed change is needed. See tests for concrete specifications.

## Scope

Working but deliberately minimal: numeric weighting/contests, structural predicates, terminal Situation paths, explicit opportunity disclosures, explicit forgetting, manual interruption, and version-1 persistence. Deferred: semantic game policies, history compaction, previous-version migrations, automatic interruption triggers, retention scheduling, richer action/contest orchestration, and Dice.

The milestone report is [milestone-report.md](milestone-report.md). `OGLWE` remains read-only historical material. No code was copied from it.
