import { assert, call, copy, id } from '../../infrastructure/records.js';
import { decisionBase, decisionContext, prepare, rejectAttempt, resolveAttempt, weightDecisions } from '../actors-actions/index.js';
import { drain, hasDue, recordEvent, HARD_LIMIT } from '../events-consequences/index.js';
import { updateSituations } from '../situations/index.js';
import { compareContest, selectWeighted } from '../../infrastructure/rules/index.js';

export function start(state, context = {}) {
  assert(!state.scene, 'A Scene is already open');
  state.scene = { context: copy(context), phase: 'active', attempts: [] };
  state.checkpoint = false;
}

export function submit(state, input) {
  assert(state.scene?.phase === 'active', 'Actions require an active Scene');
  const attempt = prepare(input);
  decisionBase(state, attempt.actor);
  state.scene.attempts.push(attempt);
}

export function deferAttempts(state, attempts, due) {
  assert(state.checkpoint && !state.scene && !state.suspended.length, 'Deferred Actions require a stable checkpoint');
  assert(Number.isSafeInteger(due) && due > state.boundary, 'Deferred Action boundary must be in the future');
  assert(Array.isArray(attempts) && attempts.length > 0 && attempts.length <= HARD_LIMIT, 'Invalid deferred Actions');
  const prepared = attempts.map(input => {
    const attempt = prepare(input); decisionBase(state, attempt.actor); return attempt;
  });
  state.deferredAttempts.push({ due, attempts: prepared });
}

export function interrupt(state, context) {
  assert(state.scene?.phase === 'active', 'Only an active Scene can be interrupted');
  state.scene.interruptedAt = state.boundary;
  state.suspended.push(state.scene); state.scene = null; start(state, context);
}

export function resume(state, shell, mode = 'resume', context = {}) {
  assert(!state.scene && state.suspended.length, 'Finish the interruption before resuming');
  assert(['resume', 'transform', 'end'].includes(mode), 'Unknown resume mode');
  const frame = state.suspended.pop();
  const nestedCauses = Object.values(state.world.entities)
    .filter(record => record.consequence?.status === 'applied' && record.consequence.executedAt > frame.interruptedAt)
    .map(record => record.id);
  delete frame.interruptedAt;
  if (mode === 'end') {
    const emit = spec => recordEvent(state, shell, spec);
    for (const attempt of frame.attempts) rejectAttempt(state, attempt, 'Parent Scene ended after interruption', emit, nestedCauses, null, 'action.cancelled');
  } else {
    frame.resumeCauses = [...new Set([...(frame.resumeCauses ?? []), ...nestedCauses])];
    state.scene = frame;
    if (mode === 'transform') state.scene.context = copy(context);
  }
  state.checkpoint = !state.scene && !state.suspended.length;
}

function random(state) {
  state.random = (Math.imul(1664525, state.random) + 1013904223) >>> 0;
  return state.random / 4294967296;
}

function tieOrder(tier, tie, attempts, sample) {
  const policy = tie?.policy ?? 'actor-order';
  assert(['actor-order', 'random', 'no-winner', 'simultaneous'].includes(policy), 'Unknown contest tie policy');
  if (tier.length < 2 || policy === 'simultaneous' || policy === 'no-winner') return tier.map(entry => ({ ...entry, reject: tier.length > 1 && policy === 'no-winner' }));
  if (policy === 'actor-order') {
    const order = tie.order ?? [];
    assert(Array.isArray(order) && new Set(order).size === order.length, 'Invalid contest Actor order');
    return [...tier].sort((a, b) => {
      const actorA = attempts[a.index].actor; const actorB = attempts[b.index].actor;
      const rankA = order.indexOf(actorA); const rankB = order.indexOf(actorB);
      if (rankA >= 0 || rankB >= 0) return (rankA < 0 ? Infinity : rankA) - (rankB < 0 ? Infinity : rankB);
      return actorA.localeCompare(actorB) || a.index - b.index;
    });
  }
  const pool = [...tier]; const ordered = [];
  while (pool.length) {
    const selected = selectWeighted(pool.map(entry => ({ ...entry, weight: entry.weight ?? 1 })), sample);
    assert(selected, 'Random contest tie requires positive weight');
    ordered.push(pool.splice(pool.findIndex(entry => entry.index === selected.index), 1)[0]);
  }
  return ordered;
}

function orderAttempts(state, shell, attempts) {
  const groups = call(shell.conflicts, { attempts, world: state.world, boundary: state.boundary }, []);
  assert(Array.isArray(groups), 'Conflict policy must return an array');
  const assigned = new Set(); const starts = new Map(); const covered = new Set(); const groupIds = new Set();
  for (const group of groups) {
    id(group.id); assert(!groupIds.has(group.id), 'Duplicate conflict ID'); groupIds.add(group.id);
    assert(Array.isArray(group.entries) && group.entries.length >= 2, 'Conflict requires at least two entries');
    assert(['high-first', 'low-first'].includes(group.direction ?? 'high-first'), 'Unknown contest direction');
    const entries = group.entries.map(entry => {
      assert(Number.isSafeInteger(entry.index) && attempts[entry.index], 'Invalid conflict attempt index');
      assert(!assigned.has(entry.index), 'Attempt belongs to multiple conflicts'); assigned.add(entry.index);
      assert(Number.isFinite(entry.value), 'Contest values must be finite');
      if (entry.weight != null) assert(Number.isFinite(entry.weight) && entry.weight >= 0, 'Invalid tie weight');
      return copy(entry);
    });
    let tiers = compareContest(entries);
    if (group.direction === 'low-first') tiers = tiers.reverse();
    const ordered = [];
    tiers.forEach((tier, rank) => {
      for (const entry of tieOrder(tier, group.tie, attempts, () => random(state))) {
        ordered.push({
          index: entry.index, reject: entry.reject,
          conflict: { id: group.id, value: entry.value, rank, tiePolicy: group.tie?.policy ?? 'actor-order' },
        });
      }
    });
    const first = Math.min(...entries.map(entry => entry.index));
    assert(!starts.has(first), 'Conflicts have the same starting attempt');
    starts.set(first, ordered); entries.forEach(entry => covered.add(entry.index));
  }
  const result = [];
  attempts.forEach((attempt, index) => {
    if (starts.has(index)) {
      for (const entry of starts.get(index)) result.push({ ...entry, attempt: copy(attempts[entry.index]) });
    } else if (!covered.has(index)) result.push({ index, attempt });
  });
  return result;
}

export function resolve(state, shell, options = {}) {
  assert(state.scene?.phase === 'active', 'No active Scene');
  const allowance = options.budget ?? 1000;
  const offscreenBudget = options.offscreenBudget ?? 0;
  assert(Number.isSafeInteger(allowance) && allowance > 0 && allowance <= HARD_LIMIT, 'Invalid causal budget');
  assert(Number.isSafeInteger(offscreenBudget) && offscreenBudget >= 0 && offscreenBudget <= HARD_LIMIT, 'Invalid off-screen budget');
  state.scene.phase = 'resolving'; state.boundary++;
  const dueAttempts = state.deferredAttempts.filter(batch => batch.due <= state.boundary);
  state.deferredAttempts = state.deferredAttempts.filter(batch => batch.due > state.boundary);
  const attempts = [...dueAttempts.flatMap(batch => batch.attempts), ...state.scene.attempts];
  const budget = { left: allowance, used: 0 };
  const emit = spec => recordEvent(state, shell, spec);
  const settle = (includeDelayed = true) => {
    do {
      drain(state, shell, budget, includeDelayed);
      // Discover resulting lifecycle work even if the final effect spent the budget.
      // It remains queued in the atomic boundary snapshot for the next window.
      if (!updateSituations(state, shell, emit)) break;
    } while (budget.left > 0);
  };
  const hasImmediate = () => state.queue.some(ref => {
    const consequence = state.world.entities[ref].consequence;
    return consequence.due <= state.boundary && consequence.due === state.world.entities[consequence.event].event.boundary;
  });
  settle(false);
  // Each ordered attempt settles before the next so later attempts revalidate.
  const conflictCauses = new Map();
  for (const item of orderAttempts(state, shell, attempts)) {
    assert(!hasImmediate(), 'Causal budget exhausted before competing attempts could revalidate');
    const causes = [...new Set([...(state.scene.resumeCauses ?? []), ...(item.conflict ? (conflictCauses.get(item.conflict.id) ?? []) : [])])];
    const eventId = item.reject
      ? rejectAttempt(state, item.attempt, 'Contest tie policy produced no winner', emit, causes, item.conflict)
      : resolveAttempt(state, shell, item.attempt, emit, causes, item.conflict);
    settle(false);
    if (item.conflict) {
      const applied = Object.values(state.world.entities).filter(record => record.consequence?.event === eventId && record.consequence.status === 'applied').map(record => record.id);
      if (applied.length) conflictCauses.set(item.conflict.id, applied);
    }
  }
  drain(state, shell, budget, true);
  const processes = call(shell.worldProcesses, { world: state.world, boundary: state.boundary }, []);
  assert(Array.isArray(processes) && processes.length <= HARD_LIMIT, 'World process safety ceiling exceeded');
  for (const event of processes) emit(event);
  settle();
  if (offscreenBudget > 0 && !hasDue(state)) {
    const actors = call(shell.offscreenActors, { boundary: state.boundary }, []);
    assert(Array.isArray(actors), 'Off-screen policy must return Actor IDs');
    for (const actor of actors.slice(0, offscreenBudget)) {
      if (hasDue(state) || budget.left === 0) break;
      const context = decisionContext(state, shell, actor);
      assert(context.actor.controller === 'Autonomous', 'Off-screen selection requires an Autonomous Actor');
      const choices = weightDecisions(call(shell.choices, context, []), context.desires);
      const selected = selectWeighted(choices, () => random(state));
      if (!selected) continue;
      assert(selected.attempt.actor === actor, 'Decision may only act as its Actor');
      const selectedAttempt = prepare(selected.attempt);
      assert(context.availableActions.some(attempt => JSON.stringify(attempt) === JSON.stringify(selectedAttempt)), 'Decision must select a dynamically available Action');
      resolveAttempt(state, shell, selectedAttempt, emit);
      settle();
    }
  }
  const deferred = hasDue(state);
  state.scene = null;
  state.checkpoint = !state.suspended.length;
  return { boundary: state.boundary, phase: deferred ? 'deferred' : 'stabilized', checkpoint: state.checkpoint, processed: budget.used };
}
