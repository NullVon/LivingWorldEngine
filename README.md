# Living World Engine Core

Living World Engine Core is a game-agnostic simulation engine for persistent worlds in which Actors, Situations, Information, Events, and Consequences continue beyond the player's immediate involvement.

The governing principle is: **Core owns structure and generic resolution. Shell owns meaning.** The player and autonomous participants are Actors using the same Action pipeline. The Core does not define genre concepts, named worlds, presentation, AI, or UI.

## Architecture authority

The authoritative design records are:

- [Core Contracts v1](docs/LWE_Core_Contracts_v1.docx)
- [Six Core Pillars v1](docs/LWE_Core_Six_Pillars_v1.docx)

The implementation-facing [contract decisions](docs/implementation-contracts.md) clarify this milestone without replacing those records. See the [getting-started guide](docs/getting-started.md), [milestone report](docs/milestone-report.md), and [semantic-free acceptance test](tests/acceptance.test.js) for executable examples and current scope.

## Six pillars

| Pillar | Responsibility |
| --- | --- |
| World State | Authoritative current truth represented through generic Entities, Relations, containment, locations, and Globals |
| Actors + Actions | Shared Human and Autonomous Action-attempt pipeline with generic eligibility and arbitration |
| Information | Actor-local claims, perception, communication, provenance, and memory separate from objective truth |
| Situations | Persistent world circumstances with Shell-defined importance, awareness paths, evolution, and terminal paths |
| Events + Consequences | Objective occurrences, generic structural effects, delayed work, history, and WHY provenance |
| Scene Progression | The sole heartbeat coordinating resolution, world activity, stabilization, and completed boundaries |

Rules, persistence, diagnostics, and optional packages support these pillars. They are not additional pillars.

## Current milestone

The first semantic-free six-pillar lifecycle and its contract-conformance corrections are implemented.

- Universal `Move` changes only the acting Actor's primary location.
- The acceptance fixture moves `OBJECT_1` through its Shell-defined `RelocateObject` Action.
- `Give` supports Entities nested within the acting Actor's containment tree.
- `Interact` records a meaningful resolved Event and has no default World State effect. Shells may attach consequences through `shell.consequences`.
- Autonomous decisions receive a read-only projection of legitimate local information, dynamically eligible Actions, and opaque desire weights. They do not receive Objective World State.
- Important Situations use Shell-controlled opportunity cadence and can resurface without a hard-coded lifetime count.
- Completed Scene boundaries are serializable even when a causal budget leaves pending work. The queue and deterministic control state restore exactly; active or suspended Scenes remain unsavable.
- Expected Action denials become unavailable or failed attempts. Unexpected eligibility errors remain visible and roll back Scene resolution.

Core has no Dice, HearthVale, Kisaragi, AI, UI, or browser dependency.

## Run the tests

Node.js 22 or later is required. No dependency installation is needed.

```sh
node --test
```

The test suite covers the six-pillar acceptance chain, WHY provenance, two small Shells, persistence and restoration, runtime isolation, delayed Consequences, safe autonomous context, repeated opportunities, universal Actions, containment, validation, rollback, and causal safety limits.

## Repository layout

```text
src/
  api/
  core/
    world-state/
    actors-actions/
    information/
    situations/
    events-consequences/
    scene-progression/
  infrastructure/
    rules/
    persistence/
packages/
  dice/                 # deferred optional package; no Core dependency
tests/
docs/
```

When adding functionality, first determine which of the six pillars owns its structure. Meaning that depends on a particular game belongs in the Shell.
