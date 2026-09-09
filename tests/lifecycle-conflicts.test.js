import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/api/index.js';
import { window } from './fixtures.js';

const actor = (id, value = 0) => ({
  id, actor: { controller: 'Autonomous' }, primaryLocation: 'LOCATION_1', data: { testAttribute: value },
});

const entities = () => [
  actor('ACTOR_1', 7), actor('ACTOR_2', 4), actor('ACTOR_3', 0),
  { id: 'OBJECT_1', primaryLocation: 'LOCATION_1' }, { id: 'LOCATION_1' }, { id: 'LOCATION_2' },
];

const acquire = actorId => ({ actor: actorId, type: 'AcquireObject', targets: ['OBJECT_1'] });

function conflictShell({ random = false } = {}) {
  return {
    actions: {
      AcquireObject: {
        eligible: ({ world }) => world.entities.OBJECT_1.lifecycle === 'active' && world.entities.OBJECT_1.container == null,
        resolve: ({ attempt }) => ({ effects: [{ type: 'contain', entity: 'OBJECT_1', container: attempt.actor }] }),
      },
      BoostActor2: { resolve: () => ({ effects: [{ type: 'data', entity: 'ACTOR_2', key: 'testAttribute', value: 9 }] }) },
      SecureObject: { resolve: () => ({ effects: [{ type: 'contain', entity: 'OBJECT_1', container: 'ACTOR_3' }] }) },
      Mark: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'marked', value: true }] }) },
    },
    conflicts: ({ attempts, world }) => attempts.length < 2 ? [] : [{
      id: 'CONFLICT_1', tie: random ? { policy: 'random' } : { policy: 'actor-order' },
      entries: attempts.map((attempt, index) => ({
        index, value: random ? 1 : world.entities[attempt.actor].data.testAttribute,
        ...(random ? { weight: attempt.actor === 'ACTOR_1' ? 1 : 3 } : {}),
      })),
    }],
  };
}

test('deferred competing attempts save and restore before deterministic resolution', () => {
  const shell = conflictShell({ random: true });
  const uninterrupted = createRuntime({ entities: entities(), shell, seed: 314159 });
  uninterrupted.deferAttempts([acquire('ACTOR_1'), acquire('ACTOR_2')], 1);
  const before = uninterrupted.snapshot();
  assert.equal(before.deferredAttempts.length, 1);
  assert.equal(before.deferredAttempts[0].attempts.length, 2);

  const restored = createRuntime({ saved: uninterrupted.save(), shell });
  assert.deepEqual(restored.snapshot(), before);
  window(uninterrupted);
  window(restored);

  assert.deepEqual(restored.snapshot(), uninterrupted.snapshot());
  assert.equal(restored.history().filter(record => record.attempt?.type === 'AcquireObject').length, 2);
  assert.equal(restored.history().filter(record => record.event?.data.action === 'AcquireObject').length, 2);
  assert.equal(restored.snapshot().deferredAttempts.length, 0);
  assert.notEqual(restored.snapshot().random, before.random, 'Tie resolution advances the saved RNG exactly once per draw');
  assert.equal(restored.view('ACTOR_1').length, 0);
  assert.equal(restored.view('ACTOR_2').length, 0, 'Objective conflict data is not injected into Actor Views');
});

test('a conflict remains atomic when the first competitor settles', () => {
  const shell = conflictShell();
  const r = createRuntime({ entities: entities(), shell });
  r.startScene(); r.submit(acquire('ACTOR_1')); r.submit(acquire('ACTOR_2'));
  assert.throws(() => r.save(), /checkpoint/, 'An active conflict Scene is not a persistence boundary');
  r.resolveScene({ budget: 1 });
  assert.equal(r.entity('OBJECT_1').container, 'ACTOR_1');
  assert.doesNotThrow(() => r.save());
  const why = r.why('OBJECT_1', 'container');

  const restored = createRuntime({ saved: r.save(), shell });
  window(restored);
  assert.equal(restored.entity('OBJECT_1').container, 'ACTOR_1');
  assert.deepEqual(restored.why('OBJECT_1', 'container'), why);
  assert.equal(restored.history().filter(record => record.attempt?.type === 'AcquireObject').length, 2);
  assert.equal(restored.history().filter(record => record.event?.type === 'action.failed' && record.event.actor === 'ACTOR_2').length, 1);
});

test('nested Scene changes objective contest order and resumed parent retains causal continuity', () => {
  const shell = conflictShell();
  const r = createRuntime({ entities: entities(), shell });
  r.startScene({ name: 'parent' });
  r.submit(acquire('ACTOR_1')); r.submit(acquire('ACTOR_2'));
  const pending = r.snapshot().scene.attempts;
  r.interrupt({ name: 'nested' });
  assert.deepEqual(r.snapshot().suspended[0].attempts, pending);
  r.submit({ actor: 'ACTOR_3', type: 'BoostActor2' });
  r.resolveScene();
  assert.throws(() => r.save(), /checkpoint/, 'A completed nested Scene with a suspended parent is not saveable');
  r.resume('resume');
  r.resolveScene();

  assert.equal(r.entity('OBJECT_1').container, 'ACTOR_2');
  const boost = r.history().find(record => record.consequence?.changes.some(change => change.entity === 'ACTOR_2' && change.field === 'data.testAttribute'));
  const actor2 = r.history().find(record => record.event?.actor === 'ACTOR_2' && record.event.data.action === 'AcquireObject');
  const actor1 = r.history().find(record => record.event?.actor === 'ACTOR_1' && record.event.data.action === 'AcquireObject');
  assert(r.trace(actor2.id).some(record => record.id === boost.id));
  assert(r.trace(actor1.id).some(record => record.id === boost.id));

  const restored = createRuntime({ saved: r.save(), shell });
  assert.deepEqual(restored.snapshot(), r.snapshot());
  assert.deepEqual(restored.why('OBJECT_1', 'container'), r.why('OBJECT_1', 'container'));
  assert.equal(restored.snapshot().scene, null); assert.deepEqual(restored.snapshot().suspended, []);
});

test('nested Scene may invalidate every pending parent competitor', () => {
  const shell = conflictShell();
  const r = createRuntime({ entities: entities(), shell });
  r.startScene(); r.submit(acquire('ACTOR_1')); r.submit(acquire('ACTOR_2'));
  r.interrupt();
  r.submit({ actor: 'ACTOR_3', type: 'SecureObject' });
  r.resolveScene(); r.resume('resume'); r.resolveScene();

  assert.equal(r.entity('OBJECT_1').container, 'ACTOR_3');
  const secure = r.history().find(record => record.consequence?.changes.some(change => change.entity === 'OBJECT_1' && change.field === 'container'));
  const failures = r.history().filter(record => record.event?.type === 'action.failed' && record.event.data.action === 'AcquireObject');
  assert.equal(failures.length, 2);
  failures.forEach(failure => assert(r.trace(failure.id).some(record => record.id === secure.id)));
  assert.equal(r.history().filter(record => record.consequence?.changes.some(change => change.entity === 'OBJECT_1' && change.field === 'container')).length, 1);
});

test('nested Scene terminal path makes obsolete parent Situation Actions fail once', () => {
  const situation = { id: 'SITUATION_1', situation: { affected: ['OBJECT_1'], paths: [
    { id: 'PATH_A', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'A' }, lifecycle: 'resolved' },
    { id: 'PATH_B', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'B' }, lifecycle: 'resolved' },
    { id: 'PATH_NESTED', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'nested' }, lifecycle: 'transformed' },
  ] } };
  const shell = {
    actions: Object.fromEntries(['A', 'B', 'Nested'].map(name => [`Resolve${name}`, {
      eligible: ({ world }) => world.entities.SITUATION_1.lifecycle === 'active',
      resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key: 'outcome', value: name.toLowerCase() }] }),
    }])),
  };
  const r = createRuntime({ entities: [...entities(), situation], shell });
  r.startScene();
  r.submit({ actor: 'ACTOR_1', type: 'ResolveA' }); r.submit({ actor: 'ACTOR_2', type: 'ResolveB' });
  r.interrupt(); r.submit({ actor: 'ACTOR_3', type: 'ResolveNested' }); r.resolveScene();
  r.resume('resume'); r.resolveScene();

  assert.equal(r.entity('SITUATION_1').lifecycle, 'transformed');
  assert.equal(r.history().filter(record => record.event?.type === 'situation.changed').length, 1);
  assert(r.history().some(record => record.event?.data.path === 'PATH_NESTED'));
  assert.equal(r.history().filter(record => record.event?.type === 'action.failed' && ['ResolveA', 'ResolveB'].includes(record.event.data.action)).length, 2);
  assert(r.why('SITUATION_1', 'lifecycle').nodes.some(record => record.attempt?.type === 'ResolveNested'));
});

test('resume, transform, and end define pending parent attempt behavior', () => {
  function interrupted() {
    const r = createRuntime({ entities: entities(), shell: conflictShell() });
    r.startScene({ mode: 'original' }); r.submit({ actor: 'ACTOR_1', type: 'Mark' });
    r.interrupt({ nested: true }); r.submit({ actor: 'ACTOR_3', type: 'Mark' }); r.resolveScene();
    return r;
  }

  const resumed = interrupted(); resumed.resume('resume'); resumed.resolveScene();
  assert.equal(resumed.entity('ACTOR_1').data.marked, true);

  const transformed = interrupted(); transformed.resume('transform', { mode: 'changed' });
  assert.equal(transformed.snapshot().scene.context.mode, 'changed');
  transformed.resolveScene(); assert.equal(transformed.entity('ACTOR_1').data.marked, true);

  const ended = interrupted(); ended.resume('end');
  assert.equal(ended.snapshot().scene, null); assert.deepEqual(ended.snapshot().suspended, []);
  assert.equal(ended.entity('ACTOR_1').data.marked, undefined);
  const cancellation = ended.history().find(record => record.event?.type === 'action.cancelled');
  const nested = ended.history().find(record => record.consequence?.changes.some(change => change.entity === 'ACTOR_3' && change.field === 'data.marked'));
  assert.equal(cancellation.event.data.action, 'Mark');
  assert(ended.trace(cancellation.id).some(record => record.id === nested.id));
  assert.doesNotThrow(() => ended.save());
});

test('causal budget defers conflict effects exactly once across save and restore', () => {
  const shell = conflictShell();
  const make = () => createRuntime({ entities: entities(), shell });
  const uninterrupted = make();
  uninterrupted.startScene();
  uninterrupted.submit({ actor: 'ACTOR_1', type: 'Mark' }); uninterrupted.submit({ actor: 'ACTOR_2', type: 'Mark' });
  const result = uninterrupted.resolveScene({ budget: 1 });
  assert.equal(result.phase, 'deferred'); assert.equal(result.checkpoint, true);
  assert.equal(uninterrupted.snapshot().queue.length, 1);
  assert.equal(uninterrupted.history().filter(record => record.attempt?.type === 'Mark').length, 2);

  const restored = createRuntime({ saved: uninterrupted.save(), shell });
  window(uninterrupted, [], { budget: 1 }); window(restored, [], { budget: 1 });
  assert.deepEqual(restored.snapshot(), uninterrupted.snapshot());
  assert.equal(restored.entity('ACTOR_1').data.marked, true);
  assert.equal(restored.entity('ACTOR_2').data.marked, true);
  assert.equal(restored.history().filter(record => record.attempt?.type === 'Mark').length, 2);
  assert.equal(restored.snapshot().queue.length, 0);
});
