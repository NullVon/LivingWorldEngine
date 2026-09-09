import { assert, call, copy } from '../../infrastructure/records.js';
import { decisionBase, decisionContext, prepare, resolveAttempt, weightDecisions } from '../actors-actions/index.js';
import { drain, hasDue, recordEvent, HARD_LIMIT } from '../events-consequences/index.js';
import { updateSituations } from '../situations/index.js';
import { selectWeighted } from '../../infrastructure/rules/index.js';

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

export function interrupt(state, context) {
  assert(state.scene?.phase === 'active', 'Only an active Scene can be interrupted');
  state.suspended.push(state.scene); state.scene = null; start(state, context);
}

export function resume(state, mode = 'resume', context = {}) {
  assert(!state.scene && state.suspended.length, 'Finish the interruption before resuming');
  assert(['resume', 'transform', 'end'].includes(mode), 'Unknown resume mode');
  const frame = state.suspended.pop();
  if (mode !== 'end') { state.scene = frame; if (mode === 'transform') state.scene.context = copy(context); }
  state.checkpoint = !state.scene && !state.suspended.length;
}

function random(state) {
  state.random = (Math.imul(1664525, state.random) + 1013904223) >>> 0;
  return state.random / 4294967296;
}

export function resolve(state, shell, options = {}) {
  assert(state.scene?.phase === 'active', 'No active Scene');
  const allowance = options.budget ?? 1000;
  const offscreenBudget = options.offscreenBudget ?? 0;
  assert(Number.isSafeInteger(allowance) && allowance > 0 && allowance <= HARD_LIMIT, 'Invalid causal budget');
  assert(Number.isSafeInteger(offscreenBudget) && offscreenBudget >= 0 && offscreenBudget <= HARD_LIMIT, 'Invalid off-screen budget');
  state.scene.phase = 'resolving'; state.boundary++;
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
  // Submitted attempts precede delayed world work; each attempt remains distinct.
  for (const attempt of state.scene.attempts) resolveAttempt(state, shell, attempt, emit);
  settle(false);
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
