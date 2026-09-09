import { allocate, assert, copy } from '../../infrastructure/records.js';
import { entity } from '../world-state/index.js';

export function view(world, actor) {
  assert(entity(world, actor).actor, 'View requires an Actor');
  return Object.values(world.entities).filter(e => e.claim?.actor === actor && e.lifecycle === 'active');
}

export function aware(world, actor, subject) {
  return view(world, actor).some(e => e.claim.subject === subject);
}

export function grant(state, actor, claim, source) {
  assert(entity(state.world, actor).actor, 'Receiver must be an Actor');
  entity(state.world, claim.subject);
  assert(typeof claim.key === 'string' && claim.key.length > 0, 'Claim key required');
  const changes = [];
  // Replace only direct structural contradictions; never infer semantic truth.
  for (const previous of view(state.world, actor)) {
    if (previous.claim.subject === claim.subject && previous.claim.key === claim.key) {
      previous.lifecycle = 'superseded';
      changes.push({ scope: 'entity', entity: previous.id, field: 'lifecycle', before: 'active', after: 'superseded' });
    }
  }
  const record = allocate(state, 'claim', {
    actor, subject: claim.subject, key: claim.key, value: copy(claim.value),
    certainty: claim.certainty ?? 'certain', retention: claim.retention ?? 'persistent',
    source: copy(source), lineage: copy(claim.lineage ?? []),
  });
  changes.push({ scope: 'entity', entity: record.id, field: '*', before: null, after: copy(record) });
  return changes;
}

export function forget(world, actor, claimId) {
  const record = entity(world, claimId);
  assert(record.claim?.actor === actor, 'Cannot forget another Actor\'s claim');
  const before = record.lifecycle; record.lifecycle = 'forgotten';
  return [{ scope: 'entity', entity: claimId, field: 'lifecycle', before, after: 'forgotten' }];
}
