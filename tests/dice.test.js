import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../src/api/index.js';
import { check, compare, createSeededRng, opposed, parse, roll } from '../packages/dice/index.js';
import { window } from './fixtures.js';

function samples(values) {
  let index = 0;
  return () => values[index++];
}

test('Dice expressions and caller modifiers produce structured serializable rolls', () => {
  assert.deepEqual(parse(' d20 '), { expression: '1d20', count: 1, sides: 20, modifier: 0 });
  assert.deepEqual(parse('2D6 - 1'), { expression: '2d6-1', count: 2, sides: 6, modifier: -1 });
  assert.equal(roll('1d8+3', { rng: () => 0 }).total, 4);
  const result = roll('2d6-1', { modifier: 4, rng: samples([0, 0.5]) });
  assert.deepEqual(result.keptRolls, [1, 4]);
  assert.equal(result.expressionModifier, -1); assert.equal(result.suppliedModifier, 4);
  assert.equal(result.modifier, 3); assert.equal(result.subtotal, 5); assert.equal(result.total, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.throws(() => parse('2d1'), /sides/); assert.throws(() => roll('1d6', { modifier: 0.5 }), /Modifier/);
});

test('neutral candidate selection can keep the highest or lowest roll', () => {
  const high = roll('1d20', { candidates: 2, keep: 'highest', rng: samples([0, 0.999]) });
  assert.equal(high.total, 20); assert.deepEqual(high.keptRolls, [20]); assert.deepEqual(high.discardedRolls, [1]);
  const low = roll('1d20', { candidates: 2, keep: 'lowest', rng: samples([0, 0.999]) });
  assert.equal(low.total, 1); assert.deepEqual(low.keptRolls, [1]); assert.deepEqual(low.discardedRolls, [20]);
});

test('target checks support generic directions and optional caller classification', () => {
  const result = check({
    expression: '1d20', modifier: 4, target: 24, comparison: 'gte', rng: () => 0.999,
    criticalPolicy: value => value.keptRolls[0] === 20 ? 'raw-maximum' : null,
  });
  assert.equal(result.total, 24); assert.equal(result.passed, true); assert.equal(result.margin, 0);
  assert.equal(result.classification, 'raw-maximum');
  assert.equal(check({ expression: '1d8', target: 3, comparison: 'lt', rng: () => 0 }).passed, true);
  assert.equal(compare(4, 4, 'eq'), true);
  assert.equal(roll('1d20', { rng: () => 0.999 }).classification, null, 'Raw extremes have no universal classification');
});

test('opposed checks resolve independent numeric sides without assigning meaning', () => {
  const result = opposed([
    { id: 'SIDE_A', expression: '1d20', modifier: 4 },
    { id: 'SIDE_B', expression: '1d20', modifier: 2 },
    { id: 'SIDE_C', expression: '2d6' },
  ], { rng: samples([0.5, 0.25, 0, 0]) });
  assert.deepEqual(result.results.map(side => [side.id, side.result.total]), [['SIDE_A', 15], ['SIDE_B', 8], ['SIDE_C', 2]]);
  assert.deepEqual(result.highest, ['SIDE_A']); assert.deepEqual(result.lowest, ['SIDE_C']);
  assert(!('winner' in result));
});

test('seeded RNG sequences and serialized RNG state reproduce exactly', () => {
  const a = createSeededRng(12345); const b = createSeededRng(12345);
  assert.deepEqual(roll('2d6+1', { rng: a }), roll('2d6+1', { rng: b }));
  const saved = a.save(); const restored = createSeededRng(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(roll('1d20', { rng: a }), roll('1d20', { rng: restored }));
  assert.deepEqual(a.save(), restored.save());
  const retryPoint = a.save(); const firstTry = roll('1d12', { rng: a });
  a.restore(retryPoint); assert.deepEqual(roll('1d12', { rng: a }), firstTry);
});

test('Shell Actions interpret passed and failed Dice checks through normal Core Events', () => {
  function runtime(sample) {
    const before = { sample };
    const shell = { actions: { AttemptCheck: { resolve: () => {
      const result = check({ expression: '1d20', modifier: 2, target: 12, rng: () => before.sample });
      return result.passed
        ? { type: 'action.check.passed', data: { dice: result }, effects: [{ type: 'data', entity: 'OBJECT_1', key: 'changed', value: true }] }
        : { type: 'action.check.failed', data: { dice: result }, effects: [] };
    } } } };
    return { core: createRuntime({ entities: [{ id: 'ACTOR_1', actor: { controller: 'Human' } }, { id: 'OBJECT_1' }], shell }), before };
  }
  const passed = runtime(0.5); const passedInput = structuredClone(passed.before);
  window(passed.core, [{ actor: 'ACTOR_1', type: 'AttemptCheck' }]);
  assert.equal(passed.core.entity('OBJECT_1').data.changed, true); assert.deepEqual(passed.before, passedInput);
  assert(passed.core.history().some(record => record.event?.type === 'action.check.passed' && record.event.data.dice.passed));

  const failed = runtime(0); window(failed.core, [{ actor: 'ACTOR_1', type: 'AttemptCheck' }]);
  assert.equal(failed.core.entity('OBJECT_1').data.changed, undefined);
  assert(failed.core.history().some(record => record.event?.type === 'action.check.failed' && !record.event.data.dice.passed));
  assert.equal(failed.core.history().filter(record => record.consequence).length, 0);
});

test('Shell bridges Dice totals into generic Core conflict ordering deterministically', () => {
  function run(seed) {
    const rng = createSeededRng(seed);
    const shell = {
      actions: { Acquire: {
        eligible: ({ world }) => world.entities.OBJECT_1.container == null,
        resolve: ({ attempt }) => ({ effects: [{ type: 'contain', entity: 'OBJECT_1', container: attempt.actor }] }),
      } },
      conflicts: ({ attempts }) => {
        if (attempts.length < 2) return [];
        const contest = opposed(attempts.map((attempt, index) => ({ id: String(index), expression: '1d20', modifier: attempt.params.modifier })), { rng });
        return [{ id: 'DICE_CONTEST', entries: contest.results.map(side => ({ index: Number(side.id), value: side.result.total })) }];
      },
    };
    const core = createRuntime({ entities: [
      { id: 'ACTOR_1', actor: { controller: 'Human' } }, { id: 'ACTOR_2', actor: { controller: 'Autonomous' } }, { id: 'OBJECT_1' },
    ], shell });
    window(core, [
      { actor: 'ACTOR_1', type: 'Acquire', targets: ['OBJECT_1'], params: { modifier: 4 } },
      { actor: 'ACTOR_2', type: 'Acquire', targets: ['OBJECT_1'], params: { modifier: 2 } },
    ]);
    return { snapshot: core.snapshot(), rng: rng.save() };
  }
  assert.deepEqual(run(90210), run(90210));
});

test('Shell-owned Dice state can be bundled with Core save data and restored independently', () => {
  function shellFor(rng) {
    return { actions: { RecordRoll: { resolve: () => {
      const result = roll('1d20', { rng });
      return { data: { dice: result }, effects: [{ type: 'data', entity: 'OBJECT_1', key: 'lastRoll', value: result.total }] };
    } } } };
  }
  const rng = createSeededRng(77);
  const core = createRuntime({ entities: [{ id: 'ACTOR_1', actor: { controller: 'Human' } }, { id: 'OBJECT_1' }], shell: shellFor(rng) });
  window(core, [{ actor: 'ACTOR_1', type: 'RecordRoll' }]);
  const bundle = JSON.parse(JSON.stringify({ core: core.save(), dice: rng.save() }));
  window(core, [{ actor: 'ACTOR_1', type: 'RecordRoll' }]);

  const restoredRng = createSeededRng(bundle.dice);
  const restored = createRuntime({ saved: bundle.core, shell: shellFor(restoredRng) });
  window(restored, [{ actor: 'ACTOR_1', type: 'RecordRoll' }]);
  assert.deepEqual(restored.snapshot(), core.snapshot()); assert.deepEqual(restoredRng.save(), rng.save());
});

test('mandatory Core source has no Dice package import', () => {
  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name); return entry.isDirectory() ? files(path) : [path];
    });
  }
  const source = files(fileURLToPath(new URL('../src', import.meta.url))).map(file => readFileSync(file, 'utf8')).join('\n');
  assert(!/packages[\\/]dice|@living-world-engine[\\/]dice/.test(source));
});
