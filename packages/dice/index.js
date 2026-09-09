const MAX_DICE = 100;
const MAX_SIDES = 1_000_000;
const MAX_CANDIDATES = 100;
const COMPARISONS = new Set(['gte', 'gt', 'lte', 'lt', 'eq']);

export class DiceError extends Error {
  constructor(code, message) {
    super(message); this.name = 'DiceError'; this.code = code;
  }
}

function fail(code, message) { throw new DiceError(code, message); }

function safeAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) fail('UNSAFE_TOTAL', `${label} exceeds safe integer arithmetic`);
  return value;
}

function plainCopy(value) {
  try { return structuredClone(value); }
  catch { fail('INVALID_DATA', 'Dice inputs and results must be serializable data'); }
}

function frozenCopy(value) {
  const result = plainCopy(value);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  };
  return freeze(result);
}

export function parse(expression) {
  if (typeof expression !== 'string') fail('INVALID_EXPRESSION', 'Dice expression must be a string');
  const match = /^\s*(\d*)[dD](\d+)(?:\s*([+-])\s*(\d+))?\s*$/.exec(expression);
  if (!match) fail('INVALID_EXPRESSION', 'Expected an NdM expression with an optional modifier');
  const count = Number(match[1] || 1); const sides = Number(match[2]);
  const magnitude = Number(match[4] || 0); const modifier = match[3] === '-' ? -magnitude : magnitude;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DICE) fail('INVALID_EXPRESSION', `Dice count must be from 1 to ${MAX_DICE}`);
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > MAX_SIDES) fail('INVALID_EXPRESSION', `Die sides must be from 2 to ${MAX_SIDES}`);
  if (!Number.isSafeInteger(modifier)) fail('INVALID_EXPRESSION', 'Expression modifier must be a safe integer');
  return { expression: `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`, count, sides, modifier };
}

function readRngState(seedOrState) {
  let state;
  if (Number.isInteger(seedOrState)) state = seedOrState;
  else if (seedOrState?.algorithm === 'lcg32' && Number.isInteger(seedOrState.state)) state = seedOrState.state;
  else fail('INVALID_RNG_STATE', 'Seeded RNG requires an unsigned 32-bit seed or lcg32 state');
  if (state < 0 || state > 0xffffffff) fail('INVALID_RNG_STATE', 'RNG state must be an unsigned 32-bit integer');
  return state;
}

export function createSeededRng(seedOrState = 1) {
  let state = readRngState(seedOrState);
  return Object.freeze({
    next() {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    },
    save() { return { algorithm: 'lcg32', state }; },
    restore(saved) { state = readRngState(saved); },
  });
}

function randomFunction(rng) {
  if (rng === undefined) return Math.random;
  if (typeof rng === 'function') return rng;
  if (rng && typeof rng.next === 'function') return () => rng.next();
  fail('INVALID_RNG', 'RNG must be a function or an object with next()');
}

function die(random, sides) {
  let sample;
  try { sample = random(); } catch { fail('INVALID_RNG', 'RNG threw while generating a roll'); }
  if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
    fail('INVALID_RNG', 'RNG must return a finite number in [0, 1)');
  }
  return Math.floor(sample * sides) + 1;
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_OPTIONS', 'Options must be an object');
  const modifier = options.modifier ?? 0;
  const candidates = options.candidates ?? 1;
  const keep = options.keep ?? 'first';
  if (!Number.isSafeInteger(modifier)) fail('INVALID_MODIFIER', 'Modifier must be a safe integer');
  if (!Number.isSafeInteger(candidates) || candidates < 1 || candidates > MAX_CANDIDATES) fail('INVALID_CANDIDATES', `Candidates must be from 1 to ${MAX_CANDIDATES}`);
  if (!['first', 'highest', 'lowest'].includes(keep)) fail('INVALID_KEEP', 'Keep must be first, highest, or lowest');
  return { ...options, modifier, candidates, keep };
}

function choose(candidates, keep) {
  if (keep === 'first') return 0;
  let selected = 0;
  for (let index = 1; index < candidates.length; index++) {
    if ((keep === 'highest' && candidates[index].total > candidates[selected].total)
      || (keep === 'lowest' && candidates[index].total < candidates[selected].total)) selected = index;
  }
  return selected;
}

function classify(policy, result) {
  if (policy == null) return null;
  if (typeof policy !== 'function') fail('INVALID_CLASSIFICATION_POLICY', 'Classification policy must be a function');
  let value;
  try { value = policy(frozenCopy(result)); } catch { fail('CLASSIFICATION_POLICY_ERROR', 'Classification policy threw'); }
  if (value !== null && (typeof value !== 'string' || !value.trim())) fail('INVALID_CLASSIFICATION', 'Classification must be null or a nonempty string');
  return value === null ? null : value.trim();
}

function rollBase(expression, options) {
  const parsed = parse(expression); const request = normalizeOptions(options);
  const modifier = safeAdd(parsed.modifier, request.modifier, 'Combined modifier');
  const random = randomFunction(request.rng); const candidates = [];
  for (let candidate = 0; candidate < request.candidates; candidate++) {
    const rolls = []; let subtotal = 0;
    for (let index = 0; index < parsed.count; index++) {
      const value = die(random, parsed.sides); rolls.push(value); subtotal = safeAdd(subtotal, value, 'Dice subtotal');
    }
    candidates.push({ rolls, subtotal, total: safeAdd(subtotal, modifier, 'Roll total') });
  }
  const selectedCandidate = choose(candidates, request.keep); const selected = candidates[selectedCandidate];
  return {
    expression: parsed.expression, count: parsed.count, sides: parsed.sides,
    expressionModifier: parsed.modifier, suppliedModifier: request.modifier, modifier,
    candidates, keep: request.keep, selectedCandidate,
    rolls: candidates.flatMap(candidate => candidate.rolls), keptRolls: [...selected.rolls],
    discardedRolls: candidates.filter((_, index) => index !== selectedCandidate).flatMap(candidate => candidate.rolls),
    subtotal: selected.subtotal, total: selected.total,
  };
}

export function roll(expression, options = {}) {
  const request = normalizeOptions(options); const result = rollBase(expression, request);
  return { ...result, classification: classify(request.criticalPolicy, result) };
}

export function compare(total, target, comparison = 'gte') {
  if (!Number.isFinite(total) || !Number.isFinite(target)) fail('INVALID_COMPARISON', 'Comparison values must be finite numbers');
  if (!COMPARISONS.has(comparison)) fail('INVALID_COMPARISON', 'Unknown comparison policy');
  if (comparison === 'gte') return total >= target;
  if (comparison === 'gt') return total > target;
  if (comparison === 'lte') return total <= target;
  if (comparison === 'lt') return total < target;
  return total === target;
}

export function check({ expression, target, comparison = 'gte', criticalPolicy, ...options } = {}) {
  if (!Number.isFinite(target)) fail('INVALID_TARGET', 'Target must be a finite number');
  const result = rollBase(expression, options);
  const compared = { ...result, target, comparison, margin: result.total - target, passed: compare(result.total, target, comparison) };
  return { ...compared, classification: classify(criticalPolicy, compared) };
}

export function opposed(sides, { rng } = {}) {
  if (!Array.isArray(sides) || sides.length < 2) fail('INVALID_OPPOSED_CHECK', 'Opposed checks require at least two sides');
  const ids = new Set();
  const results = sides.map(side => {
    if (!side || typeof side.id !== 'string' || !side.id || ids.has(side.id)) fail('INVALID_OPPOSED_CHECK', 'Opposed side IDs must be unique nonempty strings');
    ids.add(side.id);
    const { id, expression, ...options } = side;
    return { id, result: roll(expression, { ...options, rng: options.rng ?? rng }) };
  });
  const totals = results.map(side => side.result.total); const high = Math.max(...totals); const low = Math.min(...totals);
  return {
    results, highest: results.filter(side => side.result.total === high).map(side => side.id),
    lowest: results.filter(side => side.result.total === low).map(side => side.id),
  };
}
