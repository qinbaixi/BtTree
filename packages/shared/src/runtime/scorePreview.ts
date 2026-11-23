import { getEffectiveValue } from '../validation';
import type { CompiledItemType } from '../types';
import { evaluate, parseExpression, type Expr } from './expr';

/** Score curve of a score decorator: the score over the range of its blackboard input. */
export interface ScorePreview {
  /** Input range (x axis): the item's `Min` / `Max` properties when both are numbers, else 0..1. */
  min: number;
  max: number;
  /** Sampled points [input, score]; points whose score is not a finite number are left out. */
  points: Array<[number, number]>;
}

/** Stands in for empty string properties while sampling (see previewScore). */
const PREVIEW_KEY = 'input';

/** True when the expression reads the blackboard (a key or `get(...)`). */
export function readsBlackboard(expr: Expr): boolean {
  switch (expr.type) {
    case 'ident':
      return true;
    case 'literal':
    case 'prop':
      return false;
    case 'unary':
      return readsBlackboard(expr.operand);
    case 'binary':
      return readsBlackboard(expr.left) || readsBlackboard(expr.right);
    case 'call':
      return expr.name === 'get' || expr.args.some(readsBlackboard);
  }
}

/**
 * Samples the `simulate.score` expression of a decorator type with the given property values,
 * with every blackboard read returning the same input value. Undefined when the type has no
 * score expression, the expression does not parse or does not read the blackboard.
 */
export function previewScore(
  type: CompiledItemType,
  properties: Record<string, unknown>,
  steps = 40,
): ScorePreview | undefined {
  const src = type.simulate?.score;
  if (typeof src !== 'string') return undefined;
  let expr: Expr;
  try {
    expr = parseExpression(src);
  } catch {
    return undefined;
  }
  if (!readsBlackboard(expr)) return undefined;

  if (!Number.isFinite(steps) || steps < 1) {
    return undefined;
  }
  const sampleSteps = Math.floor(steps);

  // Every blackboard read returns the input, so the key name does not matter: an empty string
  // property (e.g. an Input key not chosen yet) gets a placeholder so that get({{Input}}) works.
  const propMap = new Map(type.properties.map((p) => [p.name, p]));
  const propValue = (name: string): unknown => {
    const prop = propMap.get(name);
    if (prop) {
      const value = getEffectiveValue(prop, properties);
      return prop.type === 'string' && (value === undefined || value === '') ? PREVIEW_KEY : value;
    }
    return Object.hasOwn(properties, name) ? properties[name] : undefined;
  };
  const lo = propValue('Min');
  const hi = propValue('Max');
  const ranged =
    typeof lo === 'number' &&
    typeof hi === 'number' &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    lo !== hi;
  const min = ranged ? Math.min(lo, hi) : 0;
  const max = ranged ? Math.max(lo, hi) : 1;

  let currentX = min;
  const ctx = { get: () => currentX, prop: propValue };
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= sampleSteps; i++) {
    currentX = min + ((max - min) * i) / sampleSteps;
    try {
      const y = evaluate(expr, ctx);
      if (typeof y === 'number' && Number.isFinite(y)) points.push([currentX, y]);
    } catch {
      // left out
    }
  }
  return { min, max, points };
}
