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

  const propValue = (name: string): unknown => {
    const prop = type.properties.find((p) => p.name === name);
    if (prop) return getEffectiveValue(prop, properties);
    return Object.hasOwn(properties, name) ? properties[name] : undefined;
  };
  const lo = propValue('Min');
  const hi = propValue('Max');
  const ranged = typeof lo === 'number' && typeof hi === 'number' && lo < hi;
  const min = ranged ? lo : 0;
  const max = ranged ? hi : 1;

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const x = min + ((max - min) * i) / steps;
    try {
      const y = evaluate(expr, { get: () => x, prop: propValue });
      if (typeof y === 'number' && Number.isFinite(y)) points.push([x, y]);
    } catch {
      // left out
    }
  }
  return { min, max, points };
}
