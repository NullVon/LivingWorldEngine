import { allocate, assert, call, copy } from '../../infrastructure/records.js';
import { change, entity, validateWorld } from '../world-state/index.js';
import { grant, forget } from '../information/index.js';
import { evaluate } from '../../infrastructure/rules/index.js';

export const HARD_LIMIT = 10000;
export const MAX_DEPTH = 128;

export function recordEvent(state, shell, spec, parent = null) {
  assert(typeof spec.type === 'string', 'Event type required');
  const causes = parent ? [parent, ...(spec.causes ?? [])] : [...(spec.causes ?? [])];
  for (const cause of causes) assert(entity(state.world, cause).consequence, 'Later Events require Consequence causes');
  const depth = causes.length ? Math.max(...causes.map(c => entity(state.world, c).consequence.depth)) + 1 : 0;
  assert(depth <= MAX_DEPTH, 'Causal depth safety ceiling exceeded');
  if (spec.actor) assert(entity(state.world, spec.actor).actor, 'Event Actor required');
  const event = allocate(state, 'event', {
    type: spec.type, actor: spec.actor ?? null, attempt: spec.attempt ?? null,
    causes, data: copy(spec.data ?? {}), boundary: state.boundary, depth,
  });
  const effects = [...(spec.effects ?? [])];
  const shellEffects = call(shell.consequences, { event, world: state.world }, []);
  assert(Array.isArray(shellEffects), 'Shell consequences must return an array');
  effects.push(...shellEffects);
  assert(effects.length <= HARD_LIMIT, 'Event effect safety ceiling exceeded');
  // Observe after this Event's structural effects, not against pre-effect truth.
  if (shell.perceive) effects.push({ type: 'perceive' });
  for (const effect of effects) {
    const due = effect.due ?? state.boundary;
    assert(Number.isSafeInteger(due) && due >= state.boundary, 'Invalid due boundary');
    const consequence = allocate(state, 'consequence', {
      event: event.id, operation: effect, due, depth, status: 'pending', changes: [],
    });
    state.queue.push(consequence.id);
  }
  return event.id;
}

export function apply(state, shell, record) {
  const c = record.consequence;
  const op = c.operation;
  // Predicate failure invalidates once. Structurally stale delayed operations also invalidate.
  if (!evaluate(op.when, state.world)) { c.status = 'invalidated'; c.reason = 'Validity predicate no longer holds'; return; }
  const prior = copy(state);
  try {
    if (op.type === 'perceive') {
      const perceptions = call(shell.perceive, { event: entity(state.world, c.event), world: state.world }, []);
      assert(Array.isArray(perceptions) && perceptions.length <= HARD_LIMIT, 'Perception must return bounded explicit grants');
      c.changes = perceptions.flatMap(observation => grant(state, observation.actor, observation.claim, { kind: 'perceived', event: c.event }));
    } else if (op.type === 'learn') c.changes = grant(state, op.actor, op.claim, {
      kind: op.sourceActor ? 'communicated' : 'perceived', event: c.event, ...(op.sourceActor ? { actor: op.sourceActor } : {}),
    });
    else if (op.type === 'forget') c.changes = forget(state.world, op.actor, op.claim);
    else if (op.type === 'situation') {
      const target = entity(state.world, op.entity);
      assert(target.situation, 'Not a Situation');
      assert(['active', 'changed', 'escalated', 'de-escalated', 'resolved', 'failed', 'expired', 'transformed', 'cancelled', 'invalidated'].includes(op.lifecycle), 'Invalid Situation lifecycle');
      c.changes = [{ scope: 'entity', entity: target.id, field: 'lifecycle', before: target.lifecycle, after: op.lifecycle }];
      target.lifecycle = op.lifecycle;
    } else if (op.type === 'emit') recordEvent(state, shell, op.event, record.id);
    else c.changes = change(state.world, op);
    c.status = 'applied'; c.executedAt = state.boundary; c.order = ++state.execution;
    validateWorld(state.world);
  } catch (error) {
    if (c.due === entity(state.world, c.event).event.boundary) throw error;
    Object.assign(state, prior);
    const restored = entity(state.world, record.id).consequence;
    restored.status = 'invalidated'; restored.reason = error.message;
  }
}

export function drain(state, shell, budget, includeDelayed = true) {
  while (budget.left > 0) {
    const index = state.queue.findIndex(ref => {
      const c = entity(state.world, ref).consequence;
      return c.due <= state.boundary && (includeDelayed || c.due === entity(state.world, c.event).event.boundary);
    });
    if (index < 0) return;
    assert(++budget.used <= HARD_LIMIT, 'Causal operation safety ceiling exceeded');
    budget.left--;
    const [ref] = state.queue.splice(index, 1);
    apply(state, shell, entity(state.world, ref));
  }
}

export function hasDue(state) {
  return state.queue.some(ref => entity(state.world, ref).consequence.due <= state.boundary);
}

export function trace(world, root) {
  const seen = new Set(); const nodes = [];
  function visit(ref) {
    if (seen.has(ref)) return;
    seen.add(ref); const item = entity(world, ref); nodes.push(copy(item));
    if (item.consequence) visit(item.consequence.event);
    if (item.event) { item.event.causes.forEach(visit); if (item.event.attempt) visit(item.event.attempt); }
    if (item.attempt) item.attempt.evidence.forEach(visit);
    if (item.claim) { visit(item.claim.source.event); item.claim.lineage.forEach(visit); }
  }
  if (root) visit(root);
  return nodes;
}

export function why(world, subject, field) {
  entity(world, subject);
  const candidates = Object.values(world.entities).filter(e => e.consequence?.status === 'applied' && e.consequence.changes.some(c => c.entity === subject && (c.field === field || c.field === '*')));
  // Execution order matters for delayed effects, not allocation order.
  candidates.sort((a, b) => a.consequence.executedAt - b.consequence.executedAt || a.consequence.order - b.consequence.order);
  const root = candidates.at(-1)?.id ?? null;
  return { subject, field, origin: root ? 'consequence' : 'bootstrap', root, nodes: trace(world, root) };
}
