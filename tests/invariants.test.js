import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, selectWeighted, compareContest } from '../src/api/index.js';
import { base, situation, window, claim, relocateObject } from './fixtures.js';

test('bootstrap rejects invalid IDs, references, duplicate IDs, cycles, and non-JSON data', () => {
  for (const entities of [
    [{ id: '' }], [{ id: 'constructor' }], [{ id: 'A', primaryLocation: 'B' }], [{ id: 'A' }, { id: 'A' }],
    [{ id: 'A', container: 'B' }, { id: 'B', container: 'A' }], [{ id: 'A', data: { n: NaN } }],
    [{ id: 'A', data: { f: () => 1 } }], [{ id: 'A', data: { date: new Date() } }],
  ]) assert.throws(() => createRuntime({ entities }));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => createRuntime({ globals: cycle }), /Cyclic/);
});

test('snapshots and Shell resolver inputs cannot mutate authoritative state', () => {
  const r = createRuntime({ entities: base(), shell: { actions: { X: { resolve: ({ world }) => {
    assert.throws(() => { world.entities.OBJECT_1.primaryLocation = 'LOCATION_2'; }, TypeError);
    return { effects: [] };
  } } } } });
  assert.throws(() => { r.entity('OBJECT_1').data.x = 1; }, TypeError);
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'X' }]);
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
});

test('a bad effect rolls back the complete boundary and input can be retried', () => {
  const shell = { actions: { X: { resolve: () => ({ effects: [
    { type: 'move', entity: 'OBJECT_1', location: 'LOCATION_2' }, { type: 'move', entity: 'OBJECT_1', location: 'MISSING' },
  ] }) } } };
  const r = createRuntime({ entities: base(), shell });
  r.startScene(); r.submit({ actor: 'ACTOR_PLAYER', type: 'X' }); const before = r.snapshot();
  assert.throws(() => r.resolveScene(), /Unknown Entity/);
  assert.deepEqual(r.snapshot(), before);
  shell.actions.X.resolve = () => ({ effects: [] });
  assert.equal(r.resolveScene().checkpoint, true);
});

test('delayed Consequences revalidate once and do not postpone stale work forever', () => {
  const r = createRuntime({ entities: base(), shell: { actions: { RelocateObject: relocateObject }, worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'scheduled', effects: [{
    type: 'move', entity: 'OBJECT_1', location: 'LOCATION_2', due: 3,
    when: { entity: 'OBJECT_1', field: 'primaryLocation', op: 'eq', value: 'LOCATION_1' },
  }] }] : [] } });
  window(r); assert.equal(r.snapshot().queue.length, 1);
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'RelocateObject', targets: ['OBJECT_1'], params: { location: 'LOCATION_2' } }]);
  window(r);
  assert.equal(r.snapshot().queue.length, 0);
  assert.equal(r.history().filter(e => e.consequence?.status === 'invalidated').length, 1);
  window(r); assert.equal(r.history().filter(e => e.consequence?.status === 'invalidated').length, 1);
});

test('delayed structurally stale operations invalidate without partial changes', () => {
  const r = createRuntime({ entities: base(), shell: { worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'scheduled', effects: [{ type: 'move', entity: 'OBJECT_1', location: 'MISSING', due: 2 }] }] : [] } });
  window(r); window(r);
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  assert(r.history().some(e => e.consequence?.status === 'invalidated'));
});

test('delayed valid work survives save/load and WHY chooses execution order', () => {
  const shell = { actions: { RelocateObject: relocateObject }, worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'scheduled', effects: [{ type: 'move', entity: 'OBJECT_1', location: 'LOCATION_2', due: 3 }] }] : [] };
  const r = createRuntime({ entities: base(), shell }); window(r);
  const loaded = createRuntime({ saved: r.save(), shell });
  window(loaded, [{ actor: 'ACTOR_PLAYER', type: 'RelocateObject', targets: ['OBJECT_1'], params: { location: 'LOCATION_1' } }]);
  window(loaded);
  assert.equal(loaded.entity('OBJECT_1').primaryLocation, 'LOCATION_2');
  assert(loaded.why('OBJECT_1', 'primaryLocation').nodes.some(e => e.event?.type === 'scheduled'));
});

test('claims may be false, transfer lineage, and be forgotten independently of history', () => {
  const r = createRuntime({ entities: base(), shell: { worldProcesses: ({ boundary, world }) => {
    if (boundary === 1) return [{ type: 'observation', effects: [{ type: 'learn', actor: 'ACTOR_1', claim: claim('OBJECT_1', 'primaryLocation', 'LOCATION_2') }] }];
    if (boundary === 3) return [{ type: 'retention', effects: Object.values(world.entities).filter(e => e.claim).map(e => ({ type: 'forget', actor: e.claim.actor, claim: e.id })) }];
    return [];
  } } });
  window(r); const initial = r.view('ACTOR_1')[0];
  window(r, [{ actor: 'ACTOR_1', type: 'Communicate', targets: ['ACTOR_2'], evidence: [initial.id], params: { claim: claim('OBJECT_1', 'primaryLocation', 'LOCATION_2') } }]);
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  const received = r.view('ACTOR_2')[0]; assert.deepEqual(received.claim.lineage, [initial.id]);
  assert.equal(received.claim.value, 'LOCATION_2');
  const history = r.history(); window(r);
  assert.equal(r.view('ACTOR_1').length, 0); assert.equal(r.view('ACTOR_2').length, 0);
  assert(history.every(e => r.history().some(next => next.id === e.id)));
  assert(r.trace(received.id).some(e => e.event?.type === 'action.resolved'));
});

test('later direct perception supersedes a belief without rewriting its source', () => {
  const r = createRuntime({ entities: base(), shell: { worldProcesses: ({ boundary }) => [{ type: 'observed', effects: [{ type: 'learn', actor: 'ACTOR_1', claim: claim('OBJECT_1', 'primaryLocation', boundary === 1 ? 'LOCATION_2' : 'LOCATION_1') }] }] } });
  window(r); const old = r.view('ACTOR_1')[0]; window(r);
  assert.equal(r.view('ACTOR_1').length, 1); assert.equal(r.view('ACTOR_1')[0].claim.value, 'LOCATION_1');
  assert.equal(r.entity(old.id).lifecycle, 'superseded'); assert.equal(r.entity(old.id).claim.value, 'LOCATION_2');
});

test('unknown Situations and another Actor\'s evidence cannot inform an attempt', () => {
  const r = createRuntime({ entities: [...base(), situation()], shell: { actions: { RelocateObject: relocateObject }, worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'observed', effects: [{ type: 'learn', actor: 'ACTOR_1', claim: claim() }] }] : [] } });
  window(r); const evidence = r.view('ACTOR_1')[0].id;
  window(r, [{ actor: 'ACTOR_2', type: 'RelocateObject', situation: 'SITUATION_1', targets: ['OBJECT_1'], params: { location: 'LOCATION_2' } }, { actor: 'ACTOR_2', type: 'Wait', evidence: [evidence] }]);
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  assert.equal(r.history().filter(e => e.event?.type === 'action.failed').length, 2);
});

test('off-screen activity requires authorization', () => {
  let calls = 0;
  const r = createRuntime({ entities: base(), shell: { offscreenActors: () => ['ACTOR_1'], choices: context => {
    calls++; assert(!('world' in context));
    return [{ weight: 1, attempt: { actor: 'ACTOR_1', type: 'Wait' } }];
  } } });
  r.startScene(); assert.equal(calls, 0); r.resolveScene(); assert.equal(calls, 0);
  window(r, [], { offscreenBudget: 1 }); assert.equal(calls, 1);
});

test('autonomous Decision Context exposes permitted local state and known incomplete information only', () => {
  let context;
  const entities = base().map(item => {
    if (item.id === 'ACTOR_1') return { ...item, data: { disposition: 'respond' } };
    if (item.id === 'OBJECT_1') return { ...item, container: 'ACTOR_1', data: { hiddenValue: 99 } };
    return item;
  });
  const hidden = { ...situation(), id: 'SITUATION_HIDDEN' };
  const shell = {
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'partial.discovery', effects: [{
      type: 'learn', actor: 'ACTOR_1', claim: claim('SITUATION_1', 'fragment', 'partial'),
    }] }] : [],
    desires: ({ actor }) => actor.data.disposition === 'respond' ? [{ id: 'DESIRE_RESPOND', weight: 7 }] : [],
    available: ({ actor }) => [{ actor: actor.id, type: 'Respond' }],
    actions: { Respond: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'responded', value: true }] }) } },
    offscreenActors: () => ['ACTOR_1'],
    choices: value => {
      context = value;
      assert(Object.isFrozen(value)); assert(Object.isFrozen(value.actor.data)); assert(Object.isFrozen(value.availableActions));
      assert.throws(() => { value.actor.data.disposition = 'changed'; }, TypeError);
      const partial = value.situations.some(item => item.id === 'SITUATION_1' && item.claims.some(record => record.claim.value === 'partial'));
      return partial ? [{ desire: 'DESIRE_RESPOND', attempt: value.availableActions[0] }] : [];
    },
  };
  const r = createRuntime({ entities: [...entities, situation(), hidden], shell });
  window(r);
  r.startScene({
    decision: { shared: { permitted: true }, actors: { ACTOR_1: { prompt: 'local' }, ACTOR_2: { prompt: 'hidden' } } },
    objectiveOnly: { secret: true },
  });
  r.resolveScene({ offscreenBudget: 1 });
  assert.equal(context.actor.data.disposition, 'respond');
  assert.equal(context.actor.primaryLocation, 'LOCATION_1');
  assert.deepEqual(context.possessions.map(item => item.id), ['OBJECT_1']);
  assert.deepEqual(context.situations.map(item => item.id), ['SITUATION_1']);
  assert.deepEqual(context.sceneContext, { shared: { permitted: true }, actor: { prompt: 'local' } });
  assert.deepEqual(context.desires, [{ id: 'DESIRE_RESPOND', weight: 7 }]);
  assert.deepEqual(context.availableActions.map(action => action.type), ['Respond']);
  assert(!('world' in context)); assert(!('entities' in context)); assert(!('globals' in context));
  assert(!JSON.stringify(context).includes('SITUATION_HIDDEN'));
  assert(!JSON.stringify(context).includes('hiddenValue'));
  assert(!JSON.stringify(context).includes('objectiveOnly'));
  assert.equal(r.entity('ACTOR_1').data.responded, true, 'Incomplete known information can inform a decision');
});

test('Shell desire weights drive generic autonomous selection probabilistically', () => {
  function selected(weightA, weightB) {
    const shell = {
      desires: () => [{ id: 'DESIRE_A', weight: weightA }, { id: 'DESIRE_B', weight: weightB }],
      available: ({ actor }) => [{ actor: actor.id, type: 'ChooseA' }, { actor: actor.id, type: 'ChooseB' }],
      actions: {
        ChooseA: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'selected', value: 'A' }] }) },
        ChooseB: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'selected', value: 'B' }] }) },
      },
      offscreenActors: () => ['ACTOR_1'],
      choices: ({ availableActions }) => availableActions.map((attempt, index) => ({ desire: index === 0 ? 'DESIRE_A' : 'DESIRE_B', attempt })),
    };
    const r = createRuntime({ entities: base(), shell, seed: 1000 });
    window(r, [], { offscreenBudget: 1 });
    return r.entity('ACTOR_1').data.selected;
  }
  assert.equal(selected(3, 1), 'A');
  assert.equal(selected(1, 3), 'B');
});

test('important hidden Situations deliver only their Shell-authored opportunity', () => {
  assert.throws(() => createRuntime({ entities: [...base(), situation({ important: true })] }), /opportunity/);
  const missingCadence = createRuntime({ entities: [...base(), situation({ important: true, opportunity: { actor: 'ACTOR_PLAYER', claim: claim() } })] });
  assert.throws(() => window(missingCadence), /cadence policy/);
  const r = createRuntime({ entities: [...base(), situation({ important: true, opportunity: { actor: 'ACTOR_PLAYER', claim: claim('LOCATION_1', 'available', true) } })], shell: { surfaceOpportunity: () => true } });
  window(r);
  assert.equal(r.view('ACTOR_PLAYER').length, 1);
  assert.equal(r.view('ACTOR_PLAYER')[0].claim.subject, 'LOCATION_1');
  assert(!r.view('ACTOR_PLAYER').some(e => e.claim.subject === 'SITUATION_1'));
  assert.equal(r.history().filter(record => record.event?.type === 'situation.opportunity').length, 1);
  window(r); assert.equal(r.view('ACTOR_PLAYER').length, 1);
  assert.equal(r.history().filter(record => record.event?.type === 'situation.opportunity').length, 2);
});

test('hidden Situations expire without awareness or Player participation', () => {
  assert.throws(() => createRuntime({ entities: [...base(), situation({ paths: [] })] }), /terminal/);
  const r = createRuntime({ entities: [...base(), situation({ paths: [], expiresAt: 2 })] });
  window(r); assert.equal(r.entity('SITUATION_1').lifecycle, 'active');
  window(r); assert.equal(r.entity('SITUATION_1').lifecycle, 'expired');
  assert.equal(r.view('ACTOR_PLAYER').length, 0); assert.equal(r.why('SITUATION_1', 'lifecycle').origin, 'consequence');
});

test('stable boundaries save and restore deterministic pending causal work', () => {
  const shell = { worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'two', effects: [{ type: 'data', entity: 'OBJECT_1', key: 'x', value: 1 }, { type: 'data', entity: 'OBJECT_1', key: 'x', value: 2 }] }] : [] };
  const r = createRuntime({ entities: base(), shell });
  r.startScene(); assert.throws(() => r.save(), /checkpoint/, 'Active Scenes are not serializable checkpoints');
  const first = r.resolveScene({ budget: 1 });
  assert.equal(first.phase, 'deferred'); assert.equal(first.checkpoint, true);
  assert.equal(r.entity('OBJECT_1').data.x, 1); assert.equal(r.snapshot().queue.length, 1);
  const restored = createRuntime({ saved: r.save(), shell });
  assert.deepEqual(restored.snapshot(), r.snapshot());
  assert.equal(window(restored, [], { budget: 1 }).checkpoint, true);
  assert.equal(restored.entity('OBJECT_1').data.x, 2); assert.equal(restored.snapshot().queue.length, 0);
  window(r, [], { budget: 1 });
  assert.deepEqual(restored.snapshot(), r.snapshot(), 'Restored and uninterrupted processing are deterministic');
});

test('causal safety rejects runaway descendants and rolls back', () => {
  let event = { type: 'last', effects: [] };
  for (let i = 0; i < 130; i++) event = { type: 'chain', effects: [{ type: 'emit', event }] };
  const r = createRuntime({ entities: base(), shell: { worldProcesses: () => [event] } });
  r.startScene(); assert.throws(() => r.resolveScene(), /safety ceiling/); assert.equal(r.snapshot().boundary, 0);
});

test('later Events require an intermediate Consequence and preserve multiple causes', () => {
  const r = createRuntime({ entities: base(), shell: { worldProcesses: ({ boundary, world }) => boundary === 1 ? [{ type: 'root', effects: [{ type: 'data', entity: 'OBJECT_1', key: 'a', value: 1 }, { type: 'data', entity: 'OBJECT_1', key: 'b', value: 2 }] }] : [{ type: 'derived', causes: Object.values(world.entities).filter(e => e.consequence).map(e => e.id), effects: [] }] } });
  window(r); window(r);
  assert.equal(r.history().find(e => e.event?.type === 'derived').event.causes.length, 2);
});

test('universal Move changes only the acting Actor location and Shell can forbid it dynamically', () => {
  const r = createRuntime({ entities: base(), shell: { actions: { Move: { eligible: () => false } } } });
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Take', targets: ['OBJECT_1'] }]); assert.equal(r.entity('OBJECT_1').container, 'ACTOR_PLAYER');
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Give', targets: ['OBJECT_1', 'ACTOR_1'] }]); assert.equal(r.entity('OBJECT_1').container, 'ACTOR_1');
  window(r, [{ actor: 'ACTOR_1', type: 'Move', params: { location: 'LOCATION_2' } }]); assert.equal(r.entity('ACTOR_1').primaryLocation, 'LOCATION_1');
  const moving = createRuntime({ entities: base() });
  window(moving, [{ actor: 'ACTOR_1', type: 'Move', targets: ['OBJECT_1'], params: { location: 'LOCATION_2' } }]);
  assert.equal(moving.entity('ACTOR_1').primaryLocation, 'LOCATION_1'); assert.equal(moving.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  window(moving, [{ actor: 'ACTOR_1', type: 'Move', params: { location: 'LOCATION_2' } }]);
  assert.equal(moving.entity('ACTOR_1').primaryLocation, 'LOCATION_2'); assert.equal(moving.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  const fixed = createRuntime({ entities: base(), shell: { actions: { Move: { resolve: () => ({ effects: [{ type: 'move', entity: 'OBJECT_1', location: 'LOCATION_2' }] }) } } } });
  window(fixed, [{ actor: 'ACTOR_1', type: 'Move', params: { location: 'LOCATION_2' } }]);
  assert.equal(fixed.entity('ACTOR_1').primaryLocation, 'LOCATION_2'); assert.equal(fixed.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
});

test('Give transfers transitively possessed nested Entities', () => {
  const r = createRuntime({ entities: [
    ...base(),
    { id: 'CONTAINER_1', container: 'ACTOR_PLAYER' },
    { id: 'NESTED_1', container: 'CONTAINER_1' },
  ] });
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Give', targets: ['NESTED_1', 'ACTOR_2'] }]);
  assert.equal(r.entity('NESTED_1').container, 'ACTOR_2');
  assert.equal(r.entity('CONTAINER_1').container, 'ACTOR_PLAYER');
  assert(r.why('NESTED_1', 'container').nodes.some(record => record.attempt?.type === 'Give'));
});

test('Interact emits a meaningful Event with no default state effect and allows downstream Shell Consequences', () => {
  const neutral = createRuntime({ entities: base(), shell: { actions: { Interact: { resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key: 'wrong', value: true }] }) } } } });
  window(neutral, [{ actor: 'ACTOR_PLAYER', type: 'Interact', targets: ['OBJECT_1'] }]);
  assert.deepEqual(neutral.entity('OBJECT_1').data, {});
  assert(neutral.history().some(record => record.event?.type === 'action.resolved' && record.event.data.action === 'Interact'));
  assert.equal(neutral.history().filter(record => record.consequence).length, 0);

  const extended = createRuntime({ entities: base(), shell: { consequences: ({ event }) => event.event.data.action === 'Interact'
    ? [{ type: 'data', entity: 'OBJECT_1', key: 'responded', value: true }]
    : [] } });
  window(extended, [{ actor: 'ACTOR_PLAYER', type: 'Interact', targets: ['OBJECT_1'] }]);
  assert.equal(extended.entity('OBJECT_1').data.responded, true);
});

test('weighted selection is probabilistic, zero-safe, deterministic and explains ties in contests', () => {
  const choices = [{ weight: 80, id: 'A' }, { weight: 20, id: 'B' }];
  assert.equal(selectWeighted(choices, () => 0.1).id, 'A'); assert.equal(selectWeighted(choices, () => 0.99).id, 'B');
  assert.equal(selectWeighted([{ weight: 0 }], () => 0), null);
  assert.throws(() => selectWeighted([{ weight: -1 }], () => 0));
  assert.deepEqual(compareContest([{ id: 'A', value: 1 }, { id: 'B', value: 2 }, { id: 'C', value: 2 }]).map(g => g.map(e => e.id)), [['B', 'C'], ['A']]);
});

test('nested interruption preserves queued input and resumes, transforms, or ends explicitly', () => {
  const r = createRuntime({ entities: base() });
  r.startScene({ key: 'outer' }); r.submit({ actor: 'ACTOR_PLAYER', type: 'Wait' });
  r.interrupt({ key: 'inner' }); assert.equal(r.resolveScene().checkpoint, false); assert.throws(() => r.save());
  r.resume('transform', { key: 'changed' }); assert.equal(r.snapshot().scene.context.key, 'changed');
  r.resolveScene(); assert.equal(r.history().filter(e => e.attempt).length, 1); assert.doesNotThrow(() => r.save());
  r.startScene(); r.interrupt({}); r.resolveScene(); r.resume('end'); assert.equal(r.snapshot().checkpoint, true);
});

test('runtime isolation, version rejection, reference validation and re-entry guards', () => {
  const a = createRuntime({ entities: base() }); const b = createRuntime({ entities: base() });
  window(a, [{ actor: 'ACTOR_1', type: 'Move', params: { location: 'LOCATION_2' } }]);
  assert.equal(b.entity('ACTOR_1').primaryLocation, 'LOCATION_1');
  const parsed = JSON.parse(a.save()); parsed.version = 42; assert.throws(() => createRuntime({ saved: JSON.stringify(parsed) }), /version/);
  parsed.version = 1; parsed.state.world.entities.OBJECT_1.primaryLocation = 'missing'; assert.throws(() => createRuntime({ saved: JSON.stringify(parsed) }), /Unknown Entity/);
  let r; r = createRuntime({ entities: base(), shell: { worldProcesses: () => { r.startScene(); return []; } } });
  r.startScene(); assert.throws(() => r.resolveScene(), /re-entry/);
});

test('creation, retirement, Relation and Global changes all retain provenance', () => {
  const r = createRuntime({ entities: base(), shell: { worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'structural', effects: [
    { type: 'create', entity: { id: 'ENTITY_NEW', container: 'OBJECT_1' } },
    { type: 'relation', relation: { id: 'REL_1', from: 'ACTOR_1', to: 'ENTITY_NEW', data: { value: 1 } } },
    { type: 'global', key: 'counter', value: 1 }, { type: 'retire', entity: 'ENTITY_NEW' },
  ] }] : [] } });
  window(r); assert.equal(r.entity('ENTITY_NEW').lifecycle, 'retired');
  assert.equal(r.snapshot().world.relations.REL_1.to, 'ENTITY_NEW'); assert.equal(r.snapshot().world.globals.counter, 1);
  assert.equal(r.why('ENTITY_NEW', 'lifecycle').origin, 'consequence');
});

test('budget exhaustion queues a newly satisfied Situation before offering a checkpoint', () => {
  const r = createRuntime({ entities: [...base(), situation()], shell: { actions: { RelocateObject: relocateObject } } });
  const first = window(r, [{ actor: 'ACTOR_PLAYER', type: 'RelocateObject', targets: ['OBJECT_1'], params: { location: 'LOCATION_2' } }], { budget: 1 });
  assert.equal(first.phase, 'deferred'); assert.equal(first.checkpoint, true);
  assert.doesNotThrow(() => r.save());
  assert.equal(r.entity('SITUATION_1').lifecycle, 'active');
  assert.equal(window(r, [], { budget: 1 }).checkpoint, true);
  assert.equal(r.entity('SITUATION_1').lifecycle, 'resolved');
});

test('perception reads post-effect truth and still requires an explicit grant', () => {
  const r = createRuntime({ entities: base(), shell: { actions: { RelocateObject: relocateObject }, perceive: ({ event, world }) => event.event.data.action === 'RelocateObject' ? [{
    actor: 'ACTOR_1', claim: claim('OBJECT_1', 'primaryLocation', world.entities.OBJECT_1.primaryLocation),
  }] : [] } });
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'RelocateObject', targets: ['OBJECT_1'], params: { location: 'LOCATION_2' } }]);
  assert.equal(r.view('ACTOR_1')[0].claim.value, 'LOCATION_2');
  assert.equal(r.view('ACTOR_2').length, 0);
});

test('failed Give records an attempt and Event without moving possession', () => {
  const r = createRuntime({ entities: base() });
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Give', targets: ['OBJECT_1', 'ACTOR_1'] }]);
  assert.equal(r.entity('OBJECT_1').container, null);
  assert(r.history().some(e => e.event?.type === 'action.failed'));
});

test('dynamic availability uses the same eligibility rules and does not persist an action list', () => {
  const r = createRuntime({ entities: base(), shell: {
    available: ({ actor }) => [{ actor: actor.id, type: 'Wait' }, { actor: actor.id, type: 'Move', params: { location: 'LOCATION_2' } }],
    actions: { Move: { eligible: () => false } },
  } });
  const before = r.snapshot(); assert.deepEqual(r.available('ACTOR_PLAYER').map(a => a.type), ['Wait']);
  assert.deepEqual(r.snapshot(), before);
});

test('unexpected eligibility errors remain visible while ordinary denial filters candidates', () => {
  const shell = {
    available: ({ actor }) => [{ actor: actor.id, type: 'Denied' }, { actor: actor.id, type: 'Broken' }],
    actions: {
      Denied: { eligible: () => false, resolve: () => ({ effects: [] }) },
      Broken: { eligible: () => { throw new Error('eligibility defect'); }, resolve: () => ({ effects: [] }) },
    },
  };
  const r = createRuntime({ entities: base(), shell });
  assert.throws(() => r.available('ACTOR_PLAYER'), /eligibility defect/);
  r.startScene(); r.submit({ actor: 'ACTOR_PLAYER', type: 'Broken' }); const before = r.snapshot();
  assert.throws(() => r.resolveScene(), /eligibility defect/);
  assert.deepEqual(r.snapshot(), before, 'Unexpected hook failures roll back the boundary');
});

test('Situation parent cycles and malformed priorities are structural errors', () => {
  assert.throws(() => createRuntime({ entities: [...base(), situation({ parent: 'SITUATION_1' })] }), /cycle/);
  assert.throws(() => createRuntime({ entities: [...base(), situation({ priority: 'high' })] }), /finite/);
});
