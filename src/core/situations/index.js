import { assert, call, copy } from '../../infrastructure/records.js';
import { evaluate } from '../../infrastructure/rules/index.js';

const active = new Set(['active', 'changed', 'escalated', 'de-escalated']);
export function situations(world) {
  return Object.values(world.entities).filter(e => e.situation && active.has(e.lifecycle))
    .sort((a, b) => (b.situation.priority ?? 0) - (a.situation.priority ?? 0) || (b.situation.urgency ?? 0) - (a.situation.urgency ?? 0));
}

export function updateSituations(state, shell, recordEvent) {
  let count = 0;
  for (const item of situations(state.world)) {
    const pending = state.queue.map(ref => state.world.entities[ref].consequence.operation);
    const s = item.situation;
    if (s.important) {
      assert(typeof shell.surfaceOpportunity === 'function', 'Important Situation requires a Shell opportunity cadence policy');
      const opportunityEvents = Object.values(state.world.entities).filter(record => record.event?.type === 'situation.opportunity' && record.event.data.situation === item.id);
      const surfacedThisBoundary = opportunityEvents.some(record => record.event.boundary === state.boundary);
      const surface = !surfacedThisBoundary && call(shell.surfaceOpportunity, {
        boundary: state.boundary,
        situation: item,
        previousCount: opportunityEvents.length,
        world: state.world,
      }, false);
      assert(typeof surface === 'boolean', 'Opportunity cadence policy must return a boolean');
      if (surface) {
        recordEvent({ type: 'situation.opportunity', data: { situation: item.id, occurrence: opportunityEvents.length + 1 }, effects: [
          { type: 'learn', actor: s.opportunity.actor, claim: copy(s.opportunity.claim) },
        ] });
        count++;
      }
    }
    if (pending.some(op => op.type === 'situation' && op.entity === item.id)) continue;
    const path = s.paths.find(p => evaluate(p.when, state.world));
    const lifecycle = path?.lifecycle ?? (s.expiresAt != null && s.expiresAt <= state.boundary ? 'expired' : null);
    if (!lifecycle) continue;
    const causes = Object.values(state.world.entities).filter(e => e.consequence?.status === 'applied' && e.consequence.changes.some(c => (s.affected ?? []).includes(c.entity))).map(e => e.id);
    recordEvent({ type: 'situation.changed', causes, data: { situation: item.id, lifecycle }, effects: [{ type: 'situation', entity: item.id, lifecycle }] });
    count++;
  }
  return count;
}
