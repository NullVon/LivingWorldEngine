# Optional Dice package

`@living-world-engine/dice` is optional numeric/random infrastructure. Shells may import it; the six Core pillars do not. Dice returns plain serializable data and never reads or mutates World State, Actor Views, Situations, Scenes, Events, or Consequences.

```js
import { check, createSeededRng, opposed } from './packages/dice/index.js';

const rng = createSeededRng(1234);
const result = check({
  expression: '1d20', modifier: 4, target: 14, comparison: 'gte',
  candidates: 2, keep: 'highest', rng,
  criticalPolicy: value => value.keptRolls[0] === 20 ? 'raw-maximum' : null,
});

const contest = opposed([
  { id: 'SIDE_A', expression: '1d20', modifier: 4 },
  { id: 'SIDE_B', expression: '1d20', modifier: 2 },
], { rng });
```

## API

- `parse(expression)` accepts `NdM` plus an optional signed expression modifier.
- `roll(expression, options)` returns every candidate and die, the selected candidate, kept/discarded rolls, modifiers, subtotal, total, and optional classification.
- `check({expression, target, comparison, ...options})` adds `target`, `margin`, and `passed`. Comparisons are `gte`, `gt`, `lte`, `lt`, and `eq`.
- `opposed(sides, {rng})` rolls two or more identified sides independently and reports highest/lowest ID arrays, including ties. It assigns no fictional winner or outcome.
- `createSeededRng(seedOrState)` creates an independent deterministic `lcg32` source with `next()`, a plain-data `save()` snapshot, and `restore(snapshot)` for transaction retry.
- `compare(total, target, comparison)` applies a numeric comparison (`gte` by default) and returns a boolean.
- `DiceError` is the exported error class; its `code` identifies a validation failure.

Roll options include a caller-supplied safe-integer `modifier`, `candidates`, neutral `keep` policy (`first`, `highest`, or `lowest`), injected `rng`, and optional `criticalPolicy`. There are no universal natural-roll classifications. The caller policy receives a frozen result projection and may return a nonempty classification string or `null`.

## RNG ownership and persistence

Dice RNG state belongs to the Shell or application, not Core. Save it beside the Core save envelope and reconstruct the Shell's RNG before restoring the runtime:

```js
const savedGame = { core: runtime.save(), dice: rng.save() };
const restoredRng = createSeededRng(savedGame.dice);
const restoredRuntime = createRuntime({ saved: savedGame.core, shell: makeShell(restoredRng) });
```

Shell hooks must still obey Core transaction rules. If an application can retry a failed Core transaction after consuming external Dice state, it should snapshot the Dice RNG before progression and call `rng.restore(snapshot)` on failure.

## Historical review

The authorized read-only review was limited to `../OGLWE/www/js/lwe_dice.js`.

- Directly reusable concepts: the compact `NdM` grammar, limits of 100 dice and 1,000,000 sides, safe-integer arithmetic, injected `[0,1)` RNG validation, structured candidate rolls, and caller-defined critical classification.
- Reused after adaptation: UMD `normal/favorable/unfavorable` modes became ESM `candidates` plus neutral `first/highest/lowest`; sourced modifier arrays became one numeric caller modifier; `resolveCheck` gained selectable generic comparison directions; stateful seeded RNG snapshots and multi-side opposed checks were added.
- Unnecessary here: the UMD/CommonJS/global facade, verbose cloned error details, and an outcome-policy callback. A Shell already owns Action/Event meaning.
- Game-specific and rejected: none was found in the isolated historical file. It contained no UI, Scene, named-stat, or fictional target semantics. Legacy Kisaragi `dice.js` was not inspected or reused.

No OGLWE file was modified.
