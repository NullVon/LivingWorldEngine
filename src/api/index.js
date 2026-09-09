import { assert, copy, readonly } from '../infrastructure/records.js';
import { bootstrap, entity } from '../core/world-state/index.js';
import { view } from '../core/information/index.js';
import { decisionContext } from '../core/actors-actions/index.js';
import { why, trace } from '../core/events-consequences/index.js';
import * as scenes from '../core/scene-progression/index.js';
import * as persistence from '../infrastructure/persistence/index.js';

export { evaluate, selectWeighted, compareContest } from '../infrastructure/rules/index.js';

export function createRuntime({ entities = [], globals = {}, relations = [], shell = {}, seed = 1, saved } = {}) {
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Seed must be an unsigned 32-bit integer');
  let state = saved ? persistence.load(saved) : {
    world: bootstrap(entities, globals, relations), sequence: 0, execution: 0, boundary: 0,
    queue: [], scene: null, suspended: [], random: seed, checkpoint: true,
  };
  let busy = false;
  function transaction(fn) {
    assert(!busy, 'Runtime re-entry is forbidden'); busy = true;
    const draft = copy(state);
    try { const result = fn(draft); persistence.validateState(draft); state = draft; return result == null ? null : readonly(result); }
    finally { busy = false; }
  }
  return Object.freeze({
    snapshot: () => readonly(state),
    entity: key => readonly(entity(state.world, key)),
    view: actor => readonly(view(state.world, actor)),
    history: () => readonly(Object.values(state.world.entities).filter(e => e.event || e.consequence || e.attempt)),
    why: (subject, field) => readonly(why(state.world, subject, field)),
    trace: ref => readonly(trace(state.world, ref)),
    available: actor => {
      assert(!busy, 'Runtime re-entry is forbidden');
      return readonly(decisionContext(state, shell, actor).availableActions);
    },
    startScene: context => transaction(s => scenes.start(s, context)),
    submit: attempt => transaction(s => scenes.submit(s, attempt)),
    resolveScene: options => transaction(s => scenes.resolve(s, shell, options)),
    interrupt: context => transaction(s => scenes.interrupt(s, context)),
    resume: (mode, context) => transaction(s => scenes.resume(s, mode, context)),
    save: () => persistence.save(state),
  });
}
