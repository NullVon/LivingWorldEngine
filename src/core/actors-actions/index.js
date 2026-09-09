import { allocate, assert, call, copy, readonly } from '../../infrastructure/records.js';
import { entity } from '../world-state/index.js';
import { aware, view } from '../information/index.js';

const universal = {
  Wait: () => [],
  Interact: () => [],
  Move: ({ attempt: a }) => [{ type: 'move', entity: a.targets[0] ?? a.actor, location: a.params.location }],
  Take: ({ attempt: a }) => [{ type: 'contain', entity: a.targets[0], container: a.actor }],
  Give: ({ attempt: a }) => [{ type: 'contain', entity: a.targets[0], container: a.targets[1] }],
  Communicate: ({ attempt: a }) => a.targets.map(actor => ({
    type: 'learn', actor, claim: { ...a.params.claim, lineage: a.params.claim.lineage ?? a.evidence },
    sourceActor: a.actor,
  })),
};

export function decisionContext(state, actor) {
  const item = entity(state.world, actor);
  assert(item.actor && item.lifecycle === 'active', 'Inactive or non-Actor');
  return { actor: { id: actor, controller: item.actor.controller }, view: view(state.world, actor), boundary: state.boundary };
}

export function prepare(input) {
  const result = { targets: [], params: {}, evidence: [], ...copy(input) };
  assert(typeof result.type === 'string' && Array.isArray(result.targets) && Array.isArray(result.evidence), 'Malformed Action attempt');
  return result;
}

export function eligibility(state, shell, attempt) {
  const actor = entity(state.world, attempt.actor);
  assert(actor.actor && actor.lifecycle === 'active', 'Inactive or non-Actor');
  assert(universal[attempt.type] || shell.actions?.[attempt.type]?.resolve, 'Unknown Action');
  attempt.targets.forEach(ref => entity(state.world, ref));
  for (const ref of attempt.targets) {
    if (entity(state.world, ref).situation) assert(aware(state.world, attempt.actor, ref), 'Actor is unaware of Situation');
  }
  if (attempt.type === 'Give') assert(entity(state.world, attempt.targets[0]).container === attempt.actor, 'Actor does not possess target');
  const knowledge = view(state.world, attempt.actor);
  for (const ref of attempt.evidence) assert(knowledge.some(e => e.id === ref), 'Evidence is absent from Actor View');
  if (attempt.situation) {
    assert(entity(state.world, attempt.situation).situation, 'Not a Situation');
    assert(aware(state.world, attempt.actor, attempt.situation), 'Actor is unaware of Situation');
  }
  const context = { attempt, world: state.world, view: knowledge };
  assert(call(shell.actions?.[attempt.type]?.eligible, context, true) === true, 'Shell denied Action');
  return context;
}

export function resolveAttempt(state, shell, input, recordEvent) {
  const attempt = prepare(input);
  // Identity errors are API errors, not fictional failed attempts.
  assert(entity(state.world, attempt.actor).actor, 'Attempt requires an Actor');
  const owned = view(state.world, attempt.actor).filter(c => attempt.evidence.includes(c.id) || c.claim.subject === attempt.situation);
  const evidence = owned.map(c => c.id);
  const record = allocate(state, 'attempt', { ...attempt, evidence, boundary: state.boundary });
  let context;
  try { context = eligibility(state, shell, attempt); }
  catch (error) {
    return recordEvent({ type: 'action.failed', actor: attempt.actor, attempt: record.id, data: { action: attempt.type, reason: error.message }, effects: [] });
  }
  const custom = shell.actions?.[attempt.type]?.resolve;
  const result = custom ? call(custom, context) : { outcome: 'resolved', effects: universal[attempt.type](readonly(context)) };
  assert(result && Array.isArray(result.effects), 'Action resolver must return effects');
  return recordEvent({
    type: result.type ?? 'action.resolved', actor: attempt.actor, attempt: record.id,
    data: { action: attempt.type, outcome: result.outcome ?? 'resolved', ...(result.data ?? {}) },
    effects: result.effects,
  });
}
