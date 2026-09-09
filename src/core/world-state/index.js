import { assert, copy, id, json } from '../../infrastructure/records.js';

export function entity(world, key) {
  id(key);
  const value = world.entities[key];
  assert(value, `Unknown Entity: ${key}`);
  return value;
}

export function normalize(value) {
  return { type: 'entity', data: {}, lifecycle: 'active', primaryLocation: null, container: null, ...copy(value) };
}

export function validateWorld(world) {
  json(world);
  assert(world && [world.entities, world.relations, world.globals].every(v => v && typeof v === 'object' && !Array.isArray(v)), 'Malformed World State');
  for (const [key, item] of Object.entries(world.entities)) {
    id(key); assert(item.id === key, 'Entity key/ID mismatch');
    assert(typeof item.type === 'string' && item.type.length > 0, 'Entity type required');
    assert(item.data && !Array.isArray(item.data) && typeof item.data === 'object', 'Entity data must be an object');
    assert(typeof item.lifecycle === 'string', 'Entity lifecycle required');
    for (const field of ['primaryLocation', 'container']) if (item[field] != null) entity(world, item[field]);
    const visited = new Set([key]);
    let next = item.container;
    while (next != null) {
      assert(!visited.has(next), 'Containment cycle'); visited.add(next); next = entity(world, next).container;
    }
    if (item.actor) assert(['Human', 'Autonomous'].includes(item.actor.controller), 'Invalid controller');
    if (item.situation) {
      const s = item.situation;
      for (const value of [s.priority ?? 0, s.urgency ?? 0]) assert(Number.isFinite(value), 'Situation priority and urgency must be finite');
      if (s.expiresAt != null) assert(Number.isSafeInteger(s.expiresAt) && s.expiresAt >= 0, 'Invalid Situation expiry');
      assert(Array.isArray(s.paths) && (s.paths.length > 0 || Number.isSafeInteger(s.expiresAt)), 'Situation requires a terminal path');
      const pathIds = new Set();
      for (const path of s.paths) {
        if (path.id != null) { id(path.id); assert(!pathIds.has(path.id), 'Duplicate Situation path ID'); pathIds.add(path.id); }
        assert(['resolved', 'failed', 'expired', 'transformed', 'cancelled', 'invalidated'].includes(path.lifecycle), 'Invalid terminal lifecycle');
        assert(path.when && typeof path.when === 'object', 'Terminal predicate required');
      }
      for (const ref of s.affected ?? []) entity(world, ref);
      const parents = new Set([item.id]);
      let parent = s.parent;
      while (parent) {
        assert(!parents.has(parent), 'Situation parent cycle'); parents.add(parent);
        const record = entity(world, parent); assert(record.situation, 'Parent must be a Situation'); parent = record.situation.parent;
      }
      if (s.important) {
        assert(s.opportunity?.claim, 'Important Situation requires a legitimate opportunity');
        assert(entity(world, s.opportunity.actor).actor?.controller === 'Human', 'Opportunity recipient must be Human');
      }
    }
    if (item.claim) {
      const c = item.claim;
      assert(entity(world, c.actor).actor, 'Claim owner must be an Actor');
      entity(world, c.subject);
      assert(typeof c.key === 'string' && ['certain', 'uncertain'].includes(c.certainty), 'Malformed claim');
      assert(entity(world, c.source.event).event, 'Claim source must be an Event');
      if (c.source.actor) assert(entity(world, c.source.actor).actor, 'Claim source Actor required');
      for (const ref of c.lineage) assert(entity(world, ref).claim, 'Claim lineage must reference claims');
    }
  }
  for (const [key, rel] of Object.entries(world.relations)) {
    id(key); assert(key === rel.id, 'Relation ID mismatch'); entity(world, rel.from); entity(world, rel.to);
    assert(rel.data && typeof rel.data === 'object' && !Array.isArray(rel.data), 'Relation data required');
  }
}

export function bootstrap(values = [], globals = {}, relations = []) {
  const world = { entities: {}, globals: copy(globals), relations: {} };
  for (const value of values) {
    id(value.id); assert(!world.entities[value.id], 'Duplicate Entity');
    assert(!value.event && !value.consequence && !value.attempt && !value.claim, 'History and claims originate through Events');
    world.entities[value.id] = normalize(value);
  }
  for (const value of relations) { id(value.id); assert(!world.relations[value.id], 'Duplicate Relation'); world.relations[value.id] = copy(value); }
  validateWorld(world);
  return world;
}

// Internal only: the public API has no mutation or raw-state access.
export function change(world, op) {
  const changes = [];
  const set = (target, field, value, ref, scope = 'entity') => {
    const before = target[field] ?? null;
    target[field] = copy(value);
    changes.push({ scope, entity: ref, field, before: copy(before), after: copy(value) });
  };
  if (op.type === 'create') {
    id(op.entity.id); assert(!world.entities[op.entity.id], 'Duplicate Entity');
    assert(!['event', 'consequence', 'attempt', 'claim'].some(k => op.entity[k]), 'Reserved history component');
    world.entities[op.entity.id] = normalize(op.entity);
    changes.push({ scope: 'entity', entity: op.entity.id, field: '*', before: null, after: copy(world.entities[op.entity.id]) });
  } else if (op.type === 'relation') {
    id(op.relation.id); set(world.relations, op.relation.id, op.relation, op.relation.id, 'relation');
  } else if (op.type === 'global') {
    id(op.key); set(world.globals, op.key, op.value, op.key, 'global');
  } else {
    const target = entity(world, op.entity);
    assert(!target.event && !target.consequence && !target.attempt && !target.claim, 'History is immutable through World operations');
    if (op.type === 'move') set(target, 'primaryLocation', op.location, target.id);
    else if (op.type === 'contain') set(target, 'container', op.container, target.id);
    else if (op.type === 'retire') set(target, 'lifecycle', 'retired', target.id);
    else if (op.type === 'data') {
      id(op.key); const before = target.data[op.key] ?? null; target.data[op.key] = copy(op.value);
      changes.push({ scope: 'entity', entity: target.id, field: `data.${op.key}`, before: copy(before), after: copy(op.value) });
    } else throw new Error(`Unknown World operation: ${op.type}`);
  }
  validateWorld(world);
  return changes;
}
