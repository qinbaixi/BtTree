import { describe, expect, it } from 'vitest';
import {
  evaluate,
  evaluateText,
  ExprError,
  isTruthy,
  parseAssignment,
  parseExpression,
} from './expr';

const bb: Record<string, unknown> = { Ammo: 3, Name: 'owl', Enemy: true, Zero: 0 };
const ctx = {
  get: (key: string) => bb[key],
  prop: (name: string) => ({ Duration: 4, Mode: 'Run' })[name as 'Duration' | 'Mode'],
};
const run = (src: string) => evaluateText(src, ctx);

describe('expression parser', () => {
  it('evaluates literals', () => {
    expect(run('42')).toBe(42);
    expect(run('1.5')).toBe(1.5);
    expect(run('.5')).toBe(0.5);
    expect(run("'a b'")).toBe('a b');
    expect(run('"x"')).toBe('x');
    expect(run('true')).toBe(true);
    expect(run('false')).toBe(false);
    expect(run('null')).toBeNull();
    expect(run(String.raw`'it\'s'`)).toBe("it's");
  });

  it('resolves identifiers and properties', () => {
    expect(run('Ammo')).toBe(3);
    expect(run('Missing')).toBeNull();
    expect(run('{{Duration}}')).toBe(4);
    expect(run('{{ Duration }} * 2')).toBe(8);
    expect(run('{{Nope}}')).toBeNull();
  });

  it('honours precedence and parentheses', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('7 % 4 + 1')).toBe(4);
    expect(run('-Ammo + 1')).toBe(-2);
    expect(run('- - 2')).toBe(2);
    expect(run('2 * -3')).toBe(-6);
    expect(run('1 < 2 == true')).toBe(true);
    expect(run('true || false && false')).toBe(true);
  });

  it('compares values', () => {
    expect(run('Ammo > 0')).toBe(true);
    expect(run('Ammo >= 3')).toBe(true);
    expect(run('Ammo < 3')).toBe(false);
    expect(run('Ammo <= 3')).toBe(true);
    expect(run("Name == 'owl'")).toBe(true);
    expect(run("Name != 'owl'")).toBe(false);
    expect(run("'a' < 'b'")).toBe(true);
    expect(run('Missing == null')).toBe(true);
    expect(run('Enemy == true')).toBe(true);
    expect(run('Missing > 0')).toBe(false);
    expect(run('1 == "1"')).toBe(false);
  });

  it('applies logical operators with truthiness', () => {
    expect(run('!Zero')).toBe(true);
    expect(run('!Enemy')).toBe(false);
    expect(run('Enemy && Ammo > 0')).toBe(true);
    expect(run('Zero || Missing')).toBe(false);
    expect(run("!''")).toBe(true);
    expect(isTruthy('x')).toBe(true);
    expect(isTruthy(Number.NaN)).toBe(false);
  });

  it('short circuits', () => {
    expect(run('false && 1 / 0')).toBe(false);
    expect(run('true || 1 / 0')).toBe(true);
  });

  it('concatenates strings and adds numbers', () => {
    expect(run("'a' + 'b'")).toBe('ab');
    expect(run("'n=' + Ammo")).toBe('n=3');
    expect(run('Missing + 1')).toBe(1);
  });

  it('reports runtime type errors with the position', () => {
    expect(() => run('1 / 0')).toThrow('Division by zero (at position 2)');
    expect(() => run('5 % 0')).toThrow(ExprError);
    expect(() => run("'a' - 1")).toThrow("Operator '-' needs numbers, got 'a'");
    expect(() => run('true * 2')).toThrow(ExprError);
    expect(() => run("-'x'")).toThrow(ExprError);
    expect(() => run("'a' < 1")).toThrow(ExprError);
  });

  it('reports syntax errors with the position', () => {
    const position = (src: string): number => {
      try {
        parseExpression(src);
      } catch (e) {
        return (e as ExprError).position;
      }
      return -1;
    };
    expect(() => parseExpression('')).toThrow('Empty expression');
    expect(() => parseExpression('1 +')).toThrow('Unexpected end of expression (at position 3)');
    expect(position('1 +')).toBe(3);
    expect(position('(1 + 2')).toBe(6);
    expect(() => parseExpression('(1 + 2')).toThrow("Expected ')'");
    expect(position('1 2')).toBe(2);
    expect(position('a $ b')).toBe(2);
    expect(() => parseExpression("'abc")).toThrow('Unterminated string (at position 0)');
    expect(() => parseExpression('{{Abc')).toThrow("Unterminated '{{'");
    expect(() => parseExpression('{{ }}')).toThrow('Empty property reference');
    expect(() => parseExpression('1..2')).toThrow("Invalid number '1..2'");
    expect(() => parseExpression('a = 1')).toThrow("Unexpected '='");
    expect(() => parseExpression(')')).toThrow("Unexpected ')'");
    expect(() => parseExpression('* 2')).toThrow("Unexpected '*'");
  });

  it('produces an inspectable tree', () => {
    const expr = parseExpression('1 + 2');
    expect(expr).toMatchObject({ type: 'binary', op: '+' });
    expect(evaluate(expr, ctx)).toBe(3);
  });
});

describe('assignments', () => {
  it('parses Key = expr', () => {
    const a = parseAssignment('Ammo = Ammo - 1');
    expect(a.target).toBe('Ammo');
    expect(evaluate(a.expr, ctx)).toBe(2);
    expect(parseAssignment('Target = {{Mode}}').target).toBe('Target');
    expect(parseAssignment('A == B'.replace('==', '=')).target).toBe('A');
  });

  it('rejects malformed assignments', () => {
    expect(() => parseAssignment('Ammo')).toThrow("Expected '='");
    expect(() => parseAssignment('= 1')).toThrow('must start with a blackboard key');
    expect(() => parseAssignment('1 = 2')).toThrow('must start with a blackboard key');
    expect(() => parseAssignment('true = 2')).toThrow('must start with a blackboard key');
    expect(() => parseAssignment('A = ')).toThrow('Missing value');
    expect(() => parseAssignment('A == 1')).toThrow("Expected '='");
    expect(() => parseAssignment('A = 1 2')).toThrow('Unexpected');
    expect(() => parseAssignment('A = (1')).toThrow(ExprError);
  });
});

describe('functions', () => {
  const ctx = {
    get: (key: string) => ({ Health: 25, Name: 'x' })[key] ?? null,
    prop: (name: string) => ({ Key: 'Health', Curve: 'InverseLinear' })[name] ?? null,
  };
  const run = (src: string) => evaluateText(src, ctx);

  it('evaluates math functions', () => {
    expect(run('min(3, 1, 2)')).toBe(1);
    expect(run('max(3, Health)')).toBe(25);
    expect(run('clamp(5, 0, 1)')).toBe(1);
    expect(run('abs(-2) + pow(2, 3) + sqrt(9)')).toBe(13);
    expect(run('floor(1.7) + ceil(1.2) + round(1.5)')).toBe(5);
    expect(run('exp(0) + log(1)')).toBe(1);
  });

  it('reads the blackboard by a computed key and normalizes', () => {
    expect(run('get({{Key}})')).toBe(25);
    expect(run("get('Missing')")).toBe(null);
    expect(run('normalize(get({{Key}}), 0, 100)')).toBe(0.25);
    expect(run('normalize(200, 0, 100)')).toBe(1);
  });

  it('evaluates response curves', () => {
    expect(run("curve('linear', 0.25)")).toBe(0.25);
    expect(run('curve({{Curve}}, 0.25)')).toBe(0.75);
    expect(run("curve('Quadratic', 0.5)")).toBe(0.25);
    expect(run("curve('logistic', 0)")).toBeCloseTo(0);
    expect(run("curve('logistic', 1)")).toBeCloseTo(1);
    expect(run("curve('logistic', 0.5)")).toBeCloseTo(0.5);
    expect(run("curve('step', 0.6)")).toBe(1);
    expect(run("curve('linear', 3)")).toBe(1);
  });

  it('reports unknown functions and wrong argument counts at parse time', () => {
    expect(() => parseExpression('nope(1)')).toThrow(/Unknown function 'nope'/);
    expect(() => parseExpression('clamp(1, 2)')).toThrow(/takes 3 arguments, got 2/);
    expect(() => parseExpression('min(1,')).toThrow(ExprError);
    expect(() => parseExpression('min(1 2)')).toThrow(/Expected ',' or '\)'/);
  });

  it('reports bad arguments at run time', () => {
    expect(() => run("curve('wavy', 0.5)")).toThrow(/Unknown curve 'wavy'/);
    expect(() => run('normalize(1, 2, 2)')).toThrow(/different min and max/);
    expect(() => run("abs('a')")).toThrow(/needs numbers/);
    expect(() => run('get(1)')).toThrow(/needs a key name/);
  });

  it('keeps identifiers named like functions as blackboard keys', () => {
    expect(evaluateText('min + 1', { get: () => 2, prop: () => null })).toBe(3);
  });
});
