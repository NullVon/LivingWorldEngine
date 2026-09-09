# Living World Engine Core

A small, dependency-free implementation of the six LWE Core pillars. Core owns structure and generic resolution; Shell owns meaning. The authoritative architecture is in the two Word documents under `docs/`.

This is a contract-focused Core, not a complete game engine. It has no Dice, AI, browser, UI, or named-Shell dependency.

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
    { id: 'ACTOR_PLAYER', actor: { controller: 'Human' }, primaryLocation: 'LOCATION_1' },
    { id: 'OBJECT_1', primaryLocation: 'LOCATION_1' },
    { id: 'LOCATION_1' },
    { id: 'LOCATION_2' },
  ],
});

runtime.startScene({ participants: ['ACTOR_PLAYER'] });
runtime.submit({
  actor: 'ACTOR_PLAYER', type: 'Move',
  params: { location: 'LOCATION_2' },
});
// The Actor remains at LOCATION_1 until the Scene resolves.
runtime.resolveScene();
console.log(runtime.entity('ACTOR_PLAYER').primaryLocation); // LOCATION_2
console.log(runtime.why('ACTOR_PLAYER', 'primaryLocation'));
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
| `save()` | Versioned JSON at a completed Scene boundary |

Saved control state includes pending and already-due deferred Consequences, causal counters, the boundary number, and deterministic random state. Supply the Shell again on restore; functions are not serialized. Unknown save versions are rejected explicitly. Saving is allowed after a Scene transaction completes even when its budget leaves pending work; that queue resumes deterministically after restoration. Saving remains blocked while a Scene is active or suspended, so partially applied Scene transactions are never exposed. Advance large skips by repeating Scene windows. There is no background timer.

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

Universal Actions are `Move`, `Take`, `Give`, `Communicate`, `Interact`, and `Wait`. Move accepts no target and changes only the acting Actor's `primaryLocation`. Relocating another Entity requires a Shell-defined Action, as demonstrated by the acceptance fixture's neutral `RelocateObject`; it is not a universal Action. Give accepts `[possessedEntity, receiver]` and permits any Entity transitively contained by the acting Actor. Communicate accepts recipient targets and `params.claim`. Wait has no default effect. Interact creates a meaningful resolved Action Event with no built-in World State effect; `shell.consequences({event, world})` can attach Shell meaning through normal Consequences. Shell eligibility may permit or forbid universal Actions in context, while their Core semantics remain fixed.

Dynamic availability suppresses expected denials returned as `false`. Exceptions thrown by `eligible`, malformed return values, and invalid candidate structures remain visible errors. During Scene resolution they roll back the complete boundary.

An Action can include a `situation` reference and current claim IDs in `evidence`. Core requires Situation awareness and validates that evidence belongs to the acting Actor. Autonomous `choices` receives a read-only Decision Context containing the Actor's own Entity data and location, structural possession information, Actor View, aware Situations represented through those claims, explicitly permitted Scene context, dynamic available Actions, and Shell-defined desire IDs/weights. It never receives Objective World State. Objective state is supplied separately to adjudication and world-process hooks. Shell authors remain responsible for using View contents to formulate meaningful decisions, including belief-based targeting outside the explicit Situation guard.

For permitted Scene data, pass `startScene({ decision: { shared: {...}, actors: { ACTOR_ID: {...} } } })`; other Scene context is not projected into autonomous decisions. `shell.desires(context)` returns opaque `{id, weight}` entries. A choice may reference one with `{desire: id, attempt}` and Core uses that weight during generic selection. `shell.available(context)` supplies candidate attempts, which Core filters through the normal eligibility path before exposing them as `availableActions`.

For mutually incompatible submitted attempts, `shell.conflicts({attempts, world, boundary})` may return a group such as `{id, entries: [{index, value}], direction, tie}`. Values and their meaning belong to the Shell. Direction is `high-first` or `low-first`; tie policy is `actor-order`, seeded `random`, `no-winner`, or `simultaneous`. Random entries may include a nonnegative `weight`. Core orders the group, settles each attempt's immediate causal work, and revalidates the next attempt against the resulting World State. The conflict decision and losing outcome remain in objective history. See `tests/conflicts.test.js` for the complete semantic-free fixtures.

An important active Situation declares a legitimate `opportunity` claim and requires `shell.surfaceOpportunity({boundary, situation, previousCount, world})`. Returning `true` surfaces that claim during the current boundary. This world-policy hook may inspect its read-only world input; autonomous `choices` still cannot. Core records every occurrence and permits later resurfacing while the Situation remains active; the Shell owns cadence and repetition.

Effects carry a generic operation plus optional `due` (absolute progression boundary) and `when` (JSON predicate). Operations include `create`, `retire`, `move`, `contain`, `data`, `relation`, `global`, `learn`, `forget`, `situation`, and `emit`. Event perception runs after immediate structural effects; presence alone grants nothing. Use explicit later Events when perception of a delayed change is needed. See tests for concrete specifications.

## Scope

Working but deliberately minimal: numeric weighting, Shell-declared competing-attempt groups, deterministic tie policies, immediate Action revalidation, structural predicates, terminal Situation paths, explicit opportunity disclosures, explicit forgetting, manual interruption, and version-1 persistence. Deferred: semantic game policies, history compaction, previous-version migrations, automatic interruption triggers, retention scheduling, richer conflict models, and Dice.

The milestone report is [milestone-report.md](milestone-report.md). `OGLWE` remains read-only historical material. No code was copied from it.
