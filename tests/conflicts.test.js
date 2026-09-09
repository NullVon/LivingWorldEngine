import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/api/index.js';
import { window } from './fixtures.js';

const actor = (id, value, controller = 'Autonomous') => ({
  id, actor: { controller }, primaryLocation: 'LOCATION_1', data: { testAttribute: value },
});

const availabilityClaim = subject => ({ subject, key: 'available', value: true });

function competition({ values = [7, 4], tie, seed = 1, actors = ['ACTOR_1', 'ACTOR_2'], direction = 'high-first', weights } = {}) {
  const entities = [
    actor(actors[0], values[0], actors[0] === 'ACTOR_PLAYER' ? 'Human' : 'Autonomous'),
    actor(actors[1], values[1], actors[1] === 'ACTOR_PLAYER' ? 'Human' : 'Autonomous'),
    { id: 'OBJECT_1' }, { id: 'LOCATION_1' },
  ];
  const shell = {
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'resource.notice', effects: actors.map(actorId => ({
      type: 'learn', actor: actorId, claim: availabilityClaim('OBJECT_1'),
    })) }] : [],
    actions: {
      AcquireObject: {
        eligible: ({ world, phase }) => phase === 'selection' || world.entities.OBJECT_1.container == null,
        resolve: ({ attempt }) => ({ effects: [{ type: 'contain', entity: 'OBJECT_1', container: attempt.actor }] }),
      },
    },
    conflicts: ({ attempts, world }) => attempts.length < 2 ? [] : [{
      id: 'CONFLICT_1', direction, tie,
      entries: attempts.map((attempt, index) => ({
        index, value: world.entities[attempt.actor].data.testAttribute,
        ...(weights ? { weight: weights[index] } : {}),
      })),
    }],
  };
  const runtime = createRuntime({ entities, shell, seed });
  window(runtime);
  return { runtime, shell };
}

const acquire = (runtime, actorId) => ({
  actor: actorId, type: 'AcquireObject', targets: ['OBJECT_1'],
  evidence: [runtime.view(actorId).find(record => record.claim.subject === 'OBJECT_1').id],
});

test('competing Actors are ordered generically and the later attempt revalidates against the winner', () => {
  const { runtime: r } = competition();
  r.startScene();
  r.submit(acquire(r, 'ACTOR_2'));
  r.submit(acquire(r, 'ACTOR_1'));
  r.resolveScene();
  assert.equal(r.entity('OBJECT_1').container, 'ACTOR_1');
  const events = r.history().filter(record => record.event?.data.action === 'AcquireObject');
  assert.deepEqual(events.map(record => [record.event.actor, record.event.type]), [
    ['ACTOR_1', 'action.resolved'], ['ACTOR_2', 'action.failed'],
  ]);
  assert.equal(events[0].event.data.conflict.value, 7);
  assert.equal(events[1].event.data.conflict.value, 4);
  const winnerConsequence = r.history().find(record => record.consequence?.event === events[0].id);
  assert(r.trace(events[1].id).some(record => record.id === winnerConsequence.id), 'Losing outcome is caused by the winning state change');
  assert(r.why('OBJECT_1', 'container').nodes.some(record => record.attempt?.actor === 'ACTOR_1'));

  const lowFirst = competition({ direction: 'low-first' }).runtime;
  window(lowFirst, [acquire(lowFirst, 'ACTOR_1'), acquire(lowFirst, 'ACTOR_2')]);
  assert.equal(lowFirst.entity('OBJECT_1').container, 'ACTOR_2', 'Shell direction controls which numeric value resolves first');
});

test('equal contests obey deterministic, seeded-random, and no-winner Shell tie policies', () => {
  const ordered = competition({ values: [5, 5], tie: { policy: 'actor-order', order: ['ACTOR_2', 'ACTOR_1'] } }).runtime;
  window(ordered, [acquire(ordered, 'ACTOR_1'), acquire(ordered, 'ACTOR_2')]);
  assert.equal(ordered.entity('OBJECT_1').container, 'ACTOR_2');

  function randomWinner(seed) {
    const r = competition({ values: [5, 5], tie: { policy: 'random' }, weights: [1, 3], seed }).runtime;
    window(r, [acquire(r, 'ACTOR_1'), acquire(r, 'ACTOR_2')]);
    return { winner: r.entity('OBJECT_1').container, history: r.history() };
  }
  assert.deepEqual(randomWinner(42), randomWinner(42));

  const none = competition({ values: [5, 5], tie: { policy: 'no-winner' } }).runtime;
  window(none, [acquire(none, 'ACTOR_1'), acquire(none, 'ACTOR_2')]);
  assert.equal(none.entity('OBJECT_1').container, null);
  assert.equal(none.history().filter(record => record.event?.type === 'action.failed').length, 2);

  const simultaneous = createRuntime({ entities: [actor('ACTOR_1', 5), actor('ACTOR_2', 5), { id: 'LOCATION_1' }], shell: {
    actions: { Mark: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'marked', value: true }] }) } },
    conflicts: ({ attempts }) => [{ id: 'CONFLICT_SIMULTANEOUS', tie: { policy: 'simultaneous' }, entries: attempts.map((attempt, index) => ({ index, value: 5 })) }],
  } });
  window(simultaneous, [{ actor: 'ACTOR_1', type: 'Mark' }, { actor: 'ACTOR_2', type: 'Mark' }]);
  assert.equal(simultaneous.entity('ACTOR_1').data.marked, true);
  assert.equal(simultaneous.entity('ACTOR_2').data.marked, true);
});

test('an Actor may select from a stale belief but authoritative revalidation decides the outcome', () => {
  let selectedFrom;
  const shell = {
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'stale.information', effects: [
      { type: 'learn', actor: 'ACTOR_1', claim: { subject: 'SITUATION_1', key: 'relevant', value: true } },
      { type: 'learn', actor: 'ACTOR_1', claim: { subject: 'OBJECT_1', key: 'primaryLocation', value: 'LOCATION_1' } },
    ] }] : [],
    actions: { ApproachBelievedLocation: {
      eligible: ({ attempt, world, phase }) => phase === 'selection' || world.entities.OBJECT_1.primaryLocation === attempt.params.believedLocation,
      resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key: 'reached', value: true }] }),
    } },
    available: ({ actor, view }) => {
      const belief = view.find(record => record.claim.subject === 'OBJECT_1' && record.claim.key === 'primaryLocation');
      const awareness = view.find(record => record.claim.subject === 'SITUATION_1');
      return belief && awareness ? [{
        actor: actor.id, type: 'ApproachBelievedLocation', situation: 'SITUATION_1',
        evidence: [belief.id, awareness.id], params: { believedLocation: belief.claim.value },
      }] : [];
    },
    choices: ({ availableActions, view }) => {
      selectedFrom = view.find(record => record.claim.subject === 'OBJECT_1').claim.value;
      return availableActions.map(attempt => ({ weight: 1, attempt }));
    },
    offscreenActors: () => ['ACTOR_1'],
  };
  const r = createRuntime({ entities: [
    actor('ACTOR_1', 0), { id: 'OBJECT_1', primaryLocation: 'LOCATION_2' },
    { id: 'LOCATION_1' }, { id: 'LOCATION_2' },
    { id: 'SITUATION_1', situation: { affected: ['OBJECT_1'], paths: [{ when: { entity: 'OBJECT_1', field: 'data.reached', op: 'eq', value: true }, lifecycle: 'resolved' }] } },
  ], shell });
  window(r);
  window(r, [], { offscreenBudget: 1 });
  assert.equal(selectedFrom, 'LOCATION_1');
  assert.equal(r.entity('OBJECT_1').primaryLocation, 'LOCATION_2');
  assert.equal(r.entity('OBJECT_1').data.reached, undefined);
  assert(r.history().some(record => record.event?.type === 'action.failed' && record.event.data.action === 'ApproachBelievedLocation'));
  assert.equal(r.view('ACTOR_1').find(record => record.claim.subject === 'OBJECT_1').claim.value, 'LOCATION_1');
});

test('incomplete Situation information can offer a response without exposing objective details', () => {
  let decision;
  const shell = {
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'partial.notice', effects: [{
      type: 'learn', actor: 'ACTOR_1', claim: { subject: 'SITUATION_1', key: 'relevant', value: true },
    }] }] : [],
    actions: { ApproachSituation: { resolve: ({ attempt }) => ({ effects: [{ type: 'data', entity: attempt.actor, key: 'approached', value: true }] }) } },
    available: ({ actor, situations }) => situations.some(item => item.id === 'SITUATION_1')
      ? [{ actor: actor.id, type: 'ApproachSituation', situation: 'SITUATION_1', evidence: situations[0].claims.map(record => record.id) }]
      : [],
    choices: context => { decision = context; return context.availableActions.map(attempt => ({ weight: 1, attempt })); },
    offscreenActors: () => ['ACTOR_1'],
  };
  const r = createRuntime({ entities: [
    actor('ACTOR_1', 0), { id: 'OBJECT_1', data: { hiddenCause: 'CAUSE_1' } }, { id: 'LOCATION_1' },
    { id: 'SITUATION_1', data: { hiddenParticipants: ['OBJECT_1'], hiddenSolution: 'SOLUTION_1' }, situation: {
      affected: ['OBJECT_1'], paths: [{ when: { entity: 'ACTOR_1', field: 'data.approached', op: 'eq', value: true }, lifecycle: 'resolved' }],
    } },
  ], shell });
  window(r); window(r, [], { offscreenBudget: 1 });
  assert.equal(r.entity('ACTOR_1').data.approached, true);
  const serialized = JSON.stringify(decision);
  assert(serialized.includes('SITUATION_1')); assert(serialized.includes('relevant'));
  assert(!serialized.includes('hiddenCause')); assert(!serialized.includes('hiddenParticipants')); assert(!serialized.includes('hiddenSolution'));
  assert(!('world' in decision));
});

test('one Situation supports three terminal paths and preserves the path that resolved first', () => {
  const situation = {
    id: 'SITUATION_1', situation: { affected: ['OBJECT_1'], paths: [
      { id: 'PATH_A', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'A' }, lifecycle: 'resolved' },
      { id: 'PATH_B', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'B' }, lifecycle: 'transformed' },
      { id: 'PATH_C', when: { entity: 'OBJECT_1', field: 'data.outcome', op: 'eq', value: 'C' }, lifecycle: 'expired' },
    ] },
  };
  const shell = mode => ({
    actions: {
      ActionA: {
        eligible: ({ world }) => world.entities.SITUATION_1.lifecycle === 'active',
        resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key: 'outcome', value: 'A' }] }),
      },
      ActionB: {
        eligible: ({ world }) => world.entities.SITUATION_1.lifecycle === 'active',
        resolve: () => ({ effects: [{ type: 'data', entity: 'OBJECT_1', key: 'outcome', value: 'B' }] }),
      },
    },
    worldProcesses: ({ boundary }) => mode === 'C' && boundary === 1
      ? [{ type: 'path.c', effects: [{ type: 'data', entity: 'OBJECT_1', key: 'outcome', value: 'C' }] }]
      : [],
  });
  const entities = [actor('ACTOR_1', 0), actor('ACTOR_2', 0), { id: 'OBJECT_1' }, { id: 'LOCATION_1' }, situation];

  const a = createRuntime({ entities, shell: shell('A') });
  window(a, [{ actor: 'ACTOR_1', type: 'ActionA' }, { actor: 'ACTOR_2', type: 'ActionB' }]);
  assert.equal(a.entity('SITUATION_1').lifecycle, 'resolved'); assert.equal(a.entity('OBJECT_1').data.outcome, 'A');
  assert(a.history().some(record => record.event?.data.path === 'PATH_A'));
  assert(a.history().some(record => record.event?.type === 'action.failed' && record.event.data.action === 'ActionB'));
  assert(a.why('SITUATION_1', 'lifecycle').nodes.some(record => record.attempt?.type === 'ActionA'));

  const b = createRuntime({ entities, shell: shell('B') });
  window(b, [{ actor: 'ACTOR_2', type: 'ActionB' }]);
  assert.equal(b.entity('SITUATION_1').lifecycle, 'transformed');
  assert(b.history().some(record => record.event?.data.path === 'PATH_B'));

  const c = createRuntime({ entities, shell: shell('C') });
  window(c);
  assert.equal(c.entity('SITUATION_1').lifecycle, 'expired');
  assert(c.history().some(record => record.event?.data.path === 'PATH_C'));
  assert(c.why('SITUATION_1', 'lifecycle').nodes.some(record => record.event?.type === 'path.c'));
});

test('Player may wait while an Actor later acts, and has no implicit conflict priority', () => {
  const situation = { id: 'SITUATION_1', situation: {
    important: true, affected: ['OBJECT_1'],
    opportunity: { actor: 'ACTOR_PLAYER', claim: availabilityClaim('SITUATION_1') },
    paths: [{ id: 'PATH_ACQUIRED', when: { entity: 'OBJECT_1', field: 'container', op: 'ne', value: null }, lifecycle: 'resolved' }],
  } };
  const shell = {
    surfaceOpportunity: ({ boundary }) => boundary === 1,
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'actor.notice', effects: [{ type: 'learn', actor: 'ACTOR_1', claim: availabilityClaim('SITUATION_1') }] }] : [],
    actions: { AcquireObject: {
      eligible: ({ world, phase }) => phase === 'selection' || world.entities.OBJECT_1.container == null,
      resolve: ({ attempt }) => ({ effects: [{ type: 'contain', entity: 'OBJECT_1', container: attempt.actor }] }),
    } },
    conflicts: ({ attempts, world }) => attempts.length < 2 ? [] : [{ id: 'CONFLICT_PLAYER', entries: attempts.map((attempt, index) => ({ index, value: world.entities[attempt.actor].data.testAttribute })) }],
  };
  const makeRuntime = () => createRuntime({ entities: [
    actor('ACTOR_PLAYER', 1, 'Human'), actor('ACTOR_1', 2), { id: 'OBJECT_1' }, { id: 'LOCATION_1' }, situation,
  ], shell });

  const later = makeRuntime();
  window(later);
  const laterPlayerEvidence = later.view('ACTOR_PLAYER')[0].id;
  const laterActorEvidence = later.view('ACTOR_1')[0].id;
  window(later, [{ actor: 'ACTOR_PLAYER', type: 'Wait', situation: 'SITUATION_1', evidence: [laterPlayerEvidence] }]);
  assert.equal(later.entity('SITUATION_1').lifecycle, 'active');
  window(later, [{ actor: 'ACTOR_1', type: 'AcquireObject', situation: 'SITUATION_1', targets: ['OBJECT_1'], evidence: [laterActorEvidence] }]);
  assert.equal(later.entity('OBJECT_1').container, 'ACTOR_1');
  assert.equal(later.entity('SITUATION_1').lifecycle, 'resolved');

  const r = makeRuntime();
  window(r);
  const playerEvidence = r.view('ACTOR_PLAYER')[0].id; const actorEvidence = r.view('ACTOR_1')[0].id;
  window(r, [
    { actor: 'ACTOR_PLAYER', type: 'AcquireObject', situation: 'SITUATION_1', targets: ['OBJECT_1'], evidence: [playerEvidence] },
    { actor: 'ACTOR_1', type: 'AcquireObject', situation: 'SITUATION_1', targets: ['OBJECT_1'], evidence: [actorEvidence] },
  ]);
  assert.equal(r.entity('OBJECT_1').container, 'ACTOR_1');
  assert(r.history().some(record => record.event?.actor === 'ACTOR_PLAYER' && record.event.type === 'action.failed'));
  assert(r.history().some(record => record.event?.actor === 'ACTOR_1' && record.event.type === 'action.resolved'));
});

test('weighted desires influence a large deterministic sample without forcing the highest weight', () => {
  function sample(seed) {
    const desires = [
      { id: 'DESIRE_A', weight: 80 }, { id: 'DESIRE_B', weight: 40 },
      { id: 'DESIRE_C', weight: 10 }, { id: 'DESIRE_ZERO', weight: 0 },
    ];
    const types = ['ActionA', 'ActionB', 'ActionC', 'ActionZero'];
    const shell = {
      desires: () => desires,
      available: ({ actor }) => types.map(type => ({ actor: actor.id, type })),
      actions: Object.fromEntries(types.map(type => [type, { resolve: () => ({ effects: [] }) }])),
      choices: ({ availableActions }) => availableActions.map((attempt, index) => ({ desire: desires[index].id, attempt })),
      offscreenActors: () => Array(260).fill('ACTOR_1'),
    };
    const r = createRuntime({ entities: [actor('ACTOR_1', 0), { id: 'LOCATION_1' }], shell, seed });
    window(r, [], { offscreenBudget: 260 });
    const counts = Object.fromEntries(types.map(type => [type, r.history().filter(record => record.attempt?.type === type).length]));
    return counts;
  }
  const first = sample(2026); const second = sample(2026);
  assert.deepEqual(first, second);
  assert(first.ActionA > first.ActionB && first.ActionB > first.ActionC && first.ActionC > 0);
  assert.equal(first.ActionZero, 0);
  assert(first.ActionB + first.ActionC > 0, 'Highest weight must influence rather than force every selection');
});
