import { assert, copy, json } from '../records.js';
import { entity, validateWorld } from '../../core/world-state/index.js';
import { hasDue } from '../../core/events-consequences/index.js';

export const VERSION = 1;

export function validateState(state) {
  json(state); validateWorld(state.world);
  assert(Number.isSafeInteger(state.boundary) && state.boundary >= 0, 'Invalid boundary');
  assert(Number.isSafeInteger(state.sequence) && state.sequence >= 0, 'Invalid ID sequence');
  assert(Number.isSafeInteger(state.execution) && state.execution >= 0, 'Invalid execution sequence');
  assert(Number.isInteger(state.random) && state.random >= 0 && state.random <= 0xffffffff, 'Invalid random state');
  assert(Array.isArray(state.queue) && new Set(state.queue).size === state.queue.length, 'Invalid queue');
  assert(Array.isArray(state.suspended), 'Invalid suspended Scenes');
  for (const ref of state.queue) assert(entity(state.world, ref).consequence?.status === 'pending', 'Queue must reference pending Consequences');
  for (const item of Object.values(state.world.entities)) {
    if (item.consequence) {
      const c = item.consequence;
      assert(entity(state.world, c.event).event, 'Consequence cause must be an Event');
      assert(['pending', 'applied', 'invalidated'].includes(c.status), 'Invalid Consequence status');
      assert(Number.isSafeInteger(c.due) && c.due >= 0 && Array.isArray(c.changes), 'Malformed Consequence');
      assert(Number.isSafeInteger(c.depth) && c.depth >= 0 && c.depth <= 128, 'Invalid causal depth');
      if (c.status === 'applied') assert(Number.isSafeInteger(c.order) && c.order > 0 && c.order <= state.execution && Number.isSafeInteger(c.executedAt) && c.executedAt <= state.boundary, 'Invalid execution provenance');
      assert((c.status === 'pending') === state.queue.includes(item.id), 'Pending Consequence queue mismatch');
    }
    if (item.event) {
      const e = item.event;
      assert(typeof e.type === 'string' && Array.isArray(e.causes), 'Malformed Event');
      assert(Number.isSafeInteger(e.depth) && e.depth >= 0 && e.depth <= 128, 'Invalid Event depth');
      for (const ref of e.causes) {
        const cause = entity(state.world, ref).consequence;
        assert(cause && cause.depth < e.depth, 'Event cause must be an earlier Consequence');
      }
      if (e.actor) assert(entity(state.world, e.actor).actor, 'Invalid Event Actor');
      if (e.attempt) assert(entity(state.world, e.attempt).attempt, 'Event attempt missing');
    }
    if (item.attempt) {
      assert(entity(state.world, item.attempt.actor).actor, 'Attempt Actor missing');
      for (const ref of item.attempt.evidence) assert(entity(state.world, ref).claim?.actor === item.attempt.actor, 'Invalid attempt evidence');
    }
  }
  assert(typeof state.checkpoint === 'boolean', 'Invalid checkpoint');
  if (state.checkpoint) assert(!state.scene && !state.suspended.length && !hasDue(state), 'Unsafe checkpoint');
}

export function save(state) {
  assert(state.checkpoint, 'Save requires a stable checkpoint');
  validateState(state);
  return JSON.stringify({ version: VERSION, state });
}

export function load(serialized) {
  const envelope = JSON.parse(serialized);
  assert(envelope.version === VERSION, 'Unsupported save version; explicit migration required');
  const state = copy(envelope.state); validateState(state);
  assert(state.checkpoint, 'Save does not describe a stable checkpoint');
  return state;
}
