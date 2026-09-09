import { allocate, assert, call, copy, id, readonly } from '../../infrastructure/records.js';
import { entity } from '../world-state/index.js';
import { aware, view } from '../information/index.js';

const universal = {
  Wait: () => [],
  Interact: () => [],
  Move: ({ attempt: a }) => [{ type: 'move', entity: a.actor, location: a.params.location }],
  Take: ({ attempt: a }) => [{ type: 'contain', entity: a.targets[0], container: a.actor }],
  Give: ({ attempt: a }) => [{ type: 'contain', entity: a.targets[0], container: a.targets[1] }],
  Communicate: ({ attempt: a }) => a.targets.map(actor => ({
    type: 'learn', actor, claim: { ...a.params.claim, lineage: a.params.claim.lineage ?? a.evidence },
    sourceActor: a.actor,
  })),
};

export class EligibilityDenied extends Error {}

function requireEligible(condition, message) {
  if (!condition) throw new EligibilityDenied(message);
}

function possessedBy(world, target, actor) {
  let container = entity(world, target).container;
  while (container) {
    if (container === actor) return true;
    container = entity(world, container).container;
  }
  return false;
}

function possessions(world, actor) {
  return Object.values(world.entities).filter(item => possessedBy(world, item.id, actor))
    .map(item => ({ id: item.id, type: item.type, lifecycle: item.lifecycle, container: item.container }));
}

export function decisionBase(state, actor) {
  const item = entity(state.world, actor);
  assert(item.actor && item.lifecycle === 'active', 'Inactive or non-Actor');
  const knowledge = view(state.world, actor);
  const knownSituations = Object.values(state.world.entities).filter(candidate => candidate.situation && knowledge.some(record => record.claim.subject === candidate.id));
  const permitted = state.scene?.context?.decision ?? {};
  return {
    actor: {
      id: actor, type: item.type, lifecycle: item.lifecycle, controller: item.actor.controller,
      data: copy(item.data), primaryLocation: item.primaryLocation, container: item.container,
    },
    possessions: possessions(state.world, actor),
    view: knowledge,
    situations: knownSituations.map(candidate => ({
      id: candidate.id,
      claims: knowledge.filter(record => record.claim.subject === candidate.id).map(record => copy(record)),
    })),
    sceneContext: { shared: copy(permitted.shared ?? {}), actor: copy(permitted.actors?.[actor] ?? {}) },
    boundary: state.boundary,
  };
}

function desireList(shell, context) {
  const desires = call(shell.desires, context, []);
  assert(Array.isArray(desires), 'Desires must be an array');
  const seen = new Set();
  for (const desire of desires) {
    id(desire.id); assert(!seen.has(desire.id), 'Duplicate desire ID'); seen.add(desire.id);
    assert(Number.isFinite(desire.weight) && desire.weight >= 0, 'Invalid desire weight');
  }
  return desires;
}

function availableList(state, shell, actor, context) {
  const candidates = call(shell.available, context, [{ actor, type: 'Wait' }]);
  assert(Array.isArray(candidates), 'Available Actions must be an array');
  return candidates.filter(input => {
    if (input.actor !== actor) return false;
    try { eligibility(state, shell, prepare(input)); return true; }
    catch (error) {
      if (error instanceof EligibilityDenied) return false;
      throw error;
    }
  }).map(prepare);
}

export function decisionContext(state, shell, actor) {
  const base = decisionBase(state, actor);
  const desires = desireList(shell, base);
  const withDesires = { ...base, desires };
  return { ...withDesires, availableActions: availableList(state, shell, actor, withDesires) };
}

export function weightDecisions(choices, desires) {
  assert(Array.isArray(choices), 'Choices must be an array');
  const weights = new Map(desires.map(desire => [desire.id, desire.weight]));
  return choices.map(choice => {
    const weight = choice.desire == null ? choice.weight : weights.get(choice.desire);
    assert(choice.desire == null || weights.has(choice.desire), 'Choice references an unknown desire');
    return { ...copy(choice), weight };
  });
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
  if (attempt.type === 'Move') {
    requireEligible(attempt.targets.length === 0, 'Move changes only the acting Actor primary location');
    entity(state.world, attempt.params.location);
  }
  for (const ref of attempt.targets) {
    if (entity(state.world, ref).situation) requireEligible(aware(state.world, attempt.actor, ref), 'Actor is unaware of Situation');
  }
  if (attempt.type === 'Give') requireEligible(possessedBy(state.world, attempt.targets[0], attempt.actor), 'Actor does not possess target');
  const knowledge = view(state.world, attempt.actor);
  for (const ref of attempt.evidence) requireEligible(knowledge.some(e => e.id === ref), 'Evidence is absent from Actor View');
  if (attempt.situation) {
    assert(entity(state.world, attempt.situation).situation, 'Not a Situation');
    requireEligible(aware(state.world, attempt.actor, attempt.situation), 'Actor is unaware of Situation');
  }
  const context = { attempt, world: state.world, view: knowledge };
  const allowed = call(shell.actions?.[attempt.type]?.eligible, context, true);
  assert(typeof allowed === 'boolean', 'Action eligibility must return a boolean');
  requireEligible(allowed, 'Shell denied Action');
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
    if (!(error instanceof EligibilityDenied)) throw error;
    return recordEvent({ type: 'action.failed', actor: attempt.actor, attempt: record.id, data: { action: attempt.type, reason: error.message }, effects: [] });
  }
  const builtIn = universal[attempt.type];
  const result = builtIn
    ? { outcome: 'resolved', effects: builtIn(readonly(context)) }
    : call(shell.actions[attempt.type].resolve, context);
  assert(result && Array.isArray(result.effects), 'Action resolver must return effects');
  return recordEvent({
    type: result.type ?? 'action.resolved', actor: attempt.actor, attempt: record.id,
    data: { action: attempt.type, outcome: result.outcome ?? 'resolved', ...(result.data ?? {}) },
    effects: result.effects,
  });
}
