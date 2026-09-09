# First milestone contracts

The two Word architecture records in this directory remain authoritative. Core Contracts v1 supplies the more specific ownership rules where the overview compresses Action effects into a single step.

## Records and authority

All persistent world participants and records use one Entity registry. An Entity has a stable `id`, opaque `type`, serializable `data`, `lifecycle`, optional `primaryLocation` and `container`, and optional structural components (`actor`, `situation`, `claim`, `attempt`, `event`, `consequence`). Relations and Globals use the structures explicitly allowed by the World State contract. Scene frames, pending input, queue IDs, counters, and checkpoint status are engine control in the save envelope, not fictional world truth.

Bootstrap is the sole direct initialization operation. The public API never exposes a mutable runtime. Action submission queues an attempt; it does not resolve it or advance the world. Resolution is synchronous and atomic at a Scene boundary. Shell callbacks receive detached, recursively frozen values. An exception rolls the boundary back, including its IDs and queues. Shell callbacks must be synchronous, deterministic and free of external side effects.

## Causal flow

Scene → attempt → objective Event → Consequence → structural mutation. World processes may originate Events. Later Events must name a Consequence as their cause. Events may also retain multiple contributing historical references. Consequences store before/after changes and execution status. A WHY query follows those references, including the claims that informed an attempt. Rejected attempts produce failed Events, not their intended changes.

## Shell interfaces

`actions[type]` supplies optional `eligible(context)` and `resolve(context)` functions. Resolution context includes objective state for adjudication. Decision contexts contain only Actor identity, its View, and the boundary number. `choices(context)` returns weighted attempts; Core selects probabilistically with an instance-local seeded generator. Human input and selected autonomous attempts converge on the same resolver. `available(context)` provides dynamic candidates through that same eligibility interface.

`perceive({event, world})` returns explicit Actor claim grants. Co-location does not grant perception. Communicate transfers a supplied claim (which can be false) and records its source and lineage. A Situation-directed Action requires an active awareness claim about that Situation. `evidence` references must belong to the acting Actor's current View; objective IDs alone cannot authorize informed reaction.

`worldProcesses({world, boundary})` returns root Event specifications at progression boundaries. `offscreenActors({boundary})` returns an ordered list of Actor IDs; its length is bounded by the caller's explicit off-screen budget. Each decision is made after the preceding Action's consequences stabilize so communication can inform a later Actor in the same window.

Situation Entities declare at least one terminal path: a generic predicate plus a terminal lifecycle. Optional expiry provides another terminal path. Important Situations must declare a Shell-authored opportunity (recipient Actor plus a legitimately disclosable claim). Core delivers that opportunity once via Event/Consequence before autonomous activity. Hidden truth is not copied into the opportunity. Shell is responsible for the legitimacy and meaning of the disclosure.

## Minimal scope and choices

Universal Actions: Move, Take, Give, Communicate, Interact, Wait. Move can target another Entity when Shell permits; Interact defaults to a meaningful attempt with no effect. Specialized effects are Shell resolvers. Contests are generic numeric ordering with explicit tied groups. Predicates are small JSON expressions, never evaluated code.

Consequence operations: create, retire, set Entity data, move, contain, upsert Relation, set Global, grant/forget a claim, change Situation state, emit a later Event. Each specification can be delayed to a boundary and have a predicate rechecked when due. Invalid delayed work is recorded once and removed from the queue. Queued work can cross windows under a Shell budget; no checkpoint is exposed while due work remains. A hard operation ceiling and causal-depth ceiling stop runaway chains.

Scenes support nested interruption frames and explicit resume/transform/end. Fictional time is Shell data changed through Consequences. No timers or real-time loop exist. Multiple windows must be advanced individually.

Save/load uses a versioned JSON envelope and structural validation. Version 1 has no older schema to migrate; unknown versions are rejected. Shell functions are supplied again on restore. Dice is deferred and is not a dependency. History compaction, semantic contradiction handling, rich retention policies, automatic emergent interruption detection, and sophisticated Situation evolution are outside this milestone.
