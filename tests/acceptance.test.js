import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/api/index.js';
import { acceptanceShell, base, situation, window, claim, ids } from './fixtures.js';

test('six-pillar semantic-free lifecycle preserves the full WHY chain after Player waits', () => {
  const r = createRuntime({ entities: [...base(), situation()], shell: acceptanceShell() });
  assert.deepEqual(base().map(e => e.id), ids);
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  assert.equal(r.view('ACTOR_1').length, 0);
  window(r);
  const initial = r.view('ACTOR_1')[0];
  window(r, [{ actor: 'ACTOR_1', type: 'Communicate', situation: 'SITUATION_1', targets: ['ACTOR_PLAYER'], evidence: [initial.id], params: { claim: claim() } }]);
  assert.equal(r.view('ACTOR_PLAYER')[0].claim.source.kind, 'communicated');
  r.startScene();
  r.submit({ actor: 'ACTOR_PLAYER', type: 'Wait', situation: 'SITUATION_1', evidence: [r.view('ACTOR_PLAYER')[0].id] });
  assert.equal(r.history().filter(e => e.attempt?.type === 'Wait').length, 0, 'Submission does not resolve');
  assert.equal(r.resolveScene().checkpoint, true);
  assert.equal(r.entity('SITUATION_1').lifecycle, 'active');
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_1');
  const result = window(r, [], { offscreenBudget: 2 });
  assert.equal(result.phase, 'stabilized');
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_2');
  assert.equal(r.entity('SITUATION_1').lifecycle, 'resolved');
  assert(r.view('ACTOR_1').some(e => e.claim.subject === 'OBJECT_1'));
  assert(r.view('ACTOR_2').some(e => e.claim.subject === 'OBJECT_1'));
  assert(!r.view('ACTOR_PLAYER').some(e => e.claim.subject === 'OBJECT_1'), 'Presence is not perception');
  const why = r.why('OBJECT_1', 'primaryLocation');
  assert.equal(why.origin, 'consequence');
  const attempts = why.nodes.filter(e => e.attempt).map(e => [e.attempt.actor, e.attempt.type]);
  assert.deepEqual(attempts, [['ACTOR_2', 'RelocateObject'], ['ACTOR_1', 'Communicate'], ['ACTOR_PLAYER', 'Wait'], ['ACTOR_1', 'Communicate']]);
  assert(r.why('SITUATION_1', 'lifecycle').nodes.some(e => e.attempt?.type === 'RelocateObject'));
  const restored = createRuntime({ saved: r.save(), shell: acceptanceShell() });
  assert.deepEqual(restored.snapshot(), r.snapshot());
  assert.deepEqual(restored.why('OBJECT_1', 'primaryLocation'), why);
});

test('Shell can resurface an important Situation after repeated declines before another Actor resolves it', () => {
  const shell = {
    ...acceptanceShell(),
    surfaceOpportunity: ({ boundary }) => boundary === 1 || boundary === 3,
  };
  const r = createRuntime({ entities: [...base(), situation({
    important: true,
    opportunity: { actor: 'ACTOR_PLAYER', claim: claim() },
  })], shell });
  window(r);
  const first = r.view('ACTOR_PLAYER')[0];
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Wait', situation: 'SITUATION_1', evidence: [first.id] }]);
  assert.equal(r.entity('SITUATION_1').lifecycle, 'active');
  window(r);
  const second = r.view('ACTOR_PLAYER')[0];
  assert.notEqual(second.id, first.id);
  assert.equal(r.history().filter(record => record.event?.type === 'situation.opportunity').length, 2);
  window(r, [{ actor: 'ACTOR_PLAYER', type: 'Wait', situation: 'SITUATION_1', evidence: [second.id] }]);
  assert.equal(r.entity('SITUATION_1').lifecycle, 'active');
  window(r, [], { offscreenBudget: 2 });
  assert.equal(r.entity('SITUATION_1').lifecycle, 'resolved');
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_2');
});

test('two different tiny Shells run without changing Core semantics', () => {
  // Semantic vocabulary lives exclusively in these tiny Shell definitions.
  for (const [type, key, initial, value] of [['AdjustOrbit', 'orbitalPhase', 0, 45], ['ExchangeGreeting', 'affection', 10, 11]]) {
    const r = createRuntime({ entities: [...base().map(e => e.id === 'OBJECT_1' ? { ...e, data: { [key]: initial } } : e)], shell: {
      actions: { [type]: { resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key, value }] }) } },
    } });
    window(r, [{ actor: 'ACTOR_PLAYER', type }]);
    assert.equal(r.entity('OBJECT_1').data[key], value);
    assert(r.why('OBJECT_1', `data.${key}`).nodes.some(e => e.attempt?.type === type));
  }
});
