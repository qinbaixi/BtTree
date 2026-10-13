import { ExprError, parseAssignment, parseExpression } from './expr';
import type { SimulateJson } from '../types';

const MODES: readonly string[] = ['success', 'failure', 'manual', 'rule'];
const COMPOSITES: readonly string[] = ['selector', 'sequence', 'parallel', 'randomSelector'];
const DECORATORS: readonly string[] = [
  'invert',
  'forceSuccess',
  'forceFailure',
  'loop',
  'cooldown',
  'timeLimit',
];

export interface SimulateIssue {
  /** Field of the simulate object, e.g. `condition` or `effects[1]`. */
  field: string;
  message: string;
}

/** Error message of an expression, or undefined when it parses. */
export function checkExpression(src: string): string | undefined {
  try {
    parseExpression(src);
    return undefined;
  } catch (e) {
    return e instanceof ExprError ? e.message : String(e);
  }
}

/** Error message of an assignment (`Key = expr`), or undefined when it parses. */
export function checkAssignment(src: string): string | undefined {
  try {
    parseAssignment(src);
    return undefined;
  } catch (e) {
    return e instanceof ExprError ? e.message : String(e);
  }
}

/** Checks the simulate settings of an item type: enum values and expression syntax. */
export function validateSimulate(sim: SimulateJson | undefined): SimulateIssue[] {
  const issues: SimulateIssue[] = [];
  if (sim === undefined) {
    return issues;
  }
  if (typeof sim !== 'object' || sim === null || Array.isArray(sim)) {
    return [{ field: '', message: 'simulate must be an object' }];
  }
  if (sim.mode !== undefined && !MODES.includes(sim.mode)) {
    issues.push({ field: 'mode', message: `Unknown mode '${String(sim.mode)}'` });
  }
  if (sim.composite !== undefined && !COMPOSITES.includes(sim.composite)) {
    issues.push({ field: 'composite', message: `Unknown composite '${String(sim.composite)}'` });
  }
  if (sim.decorator !== undefined && !DECORATORS.includes(sim.decorator)) {
    issues.push({ field: 'decorator', message: `Unknown decorator '${String(sim.decorator)}'` });
  }
  for (const field of ['duration', 'count', 'ticks'] as const) {
    const value = sim[field];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const error = checkExpression(value);
      if (error) issues.push({ field, message: error });
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, message: `${field} must be a number or an expression` });
    }
  }
  if (sim.condition !== undefined) {
    const error =
      typeof sim.condition === 'string'
        ? checkExpression(sim.condition)
        : 'condition must be a string';
    if (error) issues.push({ field: 'condition', message: error });
  }
  if (sim.effects !== undefined) {
    if (!Array.isArray(sim.effects)) {
      issues.push({ field: 'effects', message: 'effects must be a list of assignments' });
    } else {
      sim.effects.forEach((effect, i) => {
        const error =
          typeof effect === 'string' ? checkAssignment(effect) : 'effect must be a string';
        if (error) issues.push({ field: `effects[${i}]`, message: error });
      });
    }
  }
  return issues;
}
