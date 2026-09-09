export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function json(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  assert(typeof value === 'object' && value !== null, 'Expected JSON-serializable data');
  assert(!seen.has(value), 'Cyclic data');
  assert(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Expected plain JSON data');
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe data key');
    json(item, seen);
  }
  assert(!Object.getOwnPropertySymbols(value).length, 'Symbol keys are not serializable');
  if (Array.isArray(value)) assert(Object.keys(value).length === value.length, 'Sparse arrays are not serializable');
  seen.delete(value);
}

export function copy(value) { json(value); return structuredClone(value); }
export function readonly(value) {
  const result = copy(value);
  function freeze(item) {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  }
  return freeze(result);
}

export function id(value) {
  assert(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value), 'Invalid ID');
  assert(!['__proto__', 'constructor', 'prototype'].includes(value), 'Unsafe ID');
  return value;
}

export function allocate(state, kind, component) {
  let key;
  do { key = `CORE_${kind}_${++state.sequence}`; } while (state.world.entities[key]);
  const entity = { id: key, type: `core.${kind}`, data: {}, lifecycle: 'active', [kind]: copy(component) };
  state.world.entities[key] = entity;
  return entity;
}

export function call(hook, context, fallback) {
  const value = hook ? hook(readonly(context)) : fallback;
  assert(!value?.then, 'Shell hooks must be synchronous');
  return value;
}
