import { assert } from '../records.js';

export function read(world, subject, field) {
  const root = subject === '$globals' ? world.globals : world.entities[subject];
  assert(typeof field === 'string' && field.split('.').every(k => !['__proto__', 'constructor', 'prototype'].includes(k)), 'Invalid field path');
  return field.split('.').reduce((v, k) => v?.[k], root);
}

export function evaluate(rule, world) {
  if (rule == null) return true;
  if (rule.all) return rule.all.every(r => evaluate(r, world));
  if (rule.any) return rule.any.some(r => evaluate(r, world));
  if (rule.not) return !evaluate(rule.not, world);
  const value = read(world, rule.entity, rule.field);
  switch (rule.op) {
    case 'eq': return JSON.stringify(value) === JSON.stringify(rule.value);
    case 'ne': return JSON.stringify(value) !== JSON.stringify(rule.value);
    case 'exists': return value !== undefined;
    case 'gt': return typeof value === 'number' && value > rule.value;
    case 'gte': return typeof value === 'number' && value >= rule.value;
    default: throw new Error('Unknown predicate operator');
  }
}

export function selectWeighted(choices, random) {
  assert(Array.isArray(choices), 'Choices must be an array');
  let total = 0;
  for (const item of choices) {
    assert(Number.isFinite(item.weight) && item.weight >= 0, 'Invalid weight'); total += item.weight;
  }
  assert(Number.isFinite(total), 'Weight total overflow');
  if (!total) return null;
  const sample = random(); assert(sample >= 0 && sample < 1, 'Random sample out of range');
  let point = sample * total;
  for (const item of choices) { point -= item.weight; if (point < 0) return item; }
  return choices.at(-1);
}

export function compareContest(entries) {
  assert(entries.every(e => Number.isFinite(e.value)), 'Contest values must be finite');
  const groups = [];
  for (const entry of [...entries].sort((a, b) => b.value - a.value)) {
    if (groups.at(-1)?.[0].value === entry.value) groups.at(-1).push(entry);
    else groups.push([entry]);
  }
  return groups;
}
