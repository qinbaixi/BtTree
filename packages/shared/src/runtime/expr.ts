/*
 * Tiny expression language of the run mode simulator. No eval / Function: a hand written tokenizer,
 * a recursive descent parser and a tree-walking evaluator.
 *
 *   literals      numbers, 'strings' or "strings", true, false, null
 *   identifiers   blackboard keys (a missing key is null)
 *   {{Prop}}      effective property value of the node / decorator / service that owns the expression
 *   operators     unary - !   * / %   + -   < <= > >=   == !=   &&   ||   and parentheses
 *   functions     name(args): see EXPRESSION_FUNCTIONS (math, get, normalize, curve)
 *   assignment    `Key = expr` (parseAssignment; used by effects only)
 */

export class ExprError extends Error {
  /** 0-based character offset of the problem in the source text. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at position ${position})`);
    this.name = 'ExprError';
    this.position = position;
  }
}

export type BinaryOp =
  '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';

export type Expr =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'ident'; name: string; pos: number }
  | { type: 'prop'; name: string; pos: number }
  | { type: 'unary'; op: '-' | '!'; operand: Expr; pos: number }
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number }
  | { type: 'call'; name: string; args: Expr[]; pos: number };

export interface Assignment {
  target: string;
  expr: Expr;
}

export interface EvalContext {
  /** Blackboard lookup. Missing keys must yield null / undefined. */
  get(key: string): unknown;
  /** Effective property value for `{{Prop}}`. */
  prop(name: string): unknown;
}

type TokenType = 'num' | 'str' | 'ident' | 'prop' | 'op' | 'end';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATORS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
  '(',
  ')',
  ',',
  '=',
];

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
    } else if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) i++;
      const text = src.slice(start, i);
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) {
        throw new ExprError(`Invalid number '${text}'`, start);
      }
      tokens.push({ type: 'num', value: text, pos: start });
    } else if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      let text = '';
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\' && i + 1 < src.length) {
          text += src[i + 1];
          i += 2;
        } else if (c === ch) {
          closed = true;
          i++;
          break;
        } else {
          text += c;
          i++;
        }
      }
      if (!closed) {
        throw new ExprError('Unterminated string', start);
      }
      tokens.push({ type: 'str', value: text, pos: start });
    } else if (isIdentStart(ch)) {
      const start = i;
      while (i < src.length && (isIdentStart(src[i]) || isDigit(src[i]))) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
    } else if (ch === '{' && src[i + 1] === '{') {
      const start = i;
      const close = src.indexOf('}}', i + 2);
      if (close < 0) {
        throw new ExprError("Unterminated '{{'", start);
      }
      const name = src.slice(i + 2, close).trim();
      if (name === '') {
        throw new ExprError('Empty property reference', start);
      }
      tokens.push({ type: 'prop', value: name, pos: start });
      i = close + 2;
    } else {
      const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
      if (!op) {
        throw new ExprError(`Unexpected character '${ch}'`, i);
      }
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
    }
  }
  tokens.push({ type: 'end', value: '', pos: src.length });
  return tokens;
}

const BINARY_LEVELS: BinaryOp[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  parseExpr(): Expr {
    return this.parseLevel(0);
  }

  expectEnd(): void {
    const token = this.peek();
    if (token.type !== 'end') {
      throw new ExprError(`Unexpected '${token.value}'`, token.pos);
    }
  }

  private parseLevel(level: number): Expr {
    if (level >= BINARY_LEVELS.length) {
      return this.parseUnary();
    }
    let left = this.parseLevel(level + 1);
    for (;;) {
      const token = this.peek();
      const op = BINARY_LEVELS[level].find((o) => token.type === 'op' && token.value === o);
      if (!op) {
        return left;
      }
      this.next();
      const right = this.parseLevel(level + 1);
      left = { type: 'binary', op, left, right, pos: token.pos };
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '!')) {
      this.next();
      return { type: 'unary', op: token.value, operand: this.parseUnary(), pos: token.pos };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.next();
    switch (token.type) {
      case 'num':
        return { type: 'literal', value: Number(token.value) };
      case 'str':
        return { type: 'literal', value: token.value };
      case 'prop':
        return { type: 'prop', name: token.value, pos: token.pos };
      case 'ident':
        if (token.value === 'true') return { type: 'literal', value: true };
        if (token.value === 'false') return { type: 'literal', value: false };
        if (token.value === 'null') return { type: 'literal', value: null };
        if (this.peek().type === 'op' && this.peek().value === '(') {
          return this.parseCall(token);
        }
        return { type: 'ident', name: token.value, pos: token.pos };
      case 'op': {
        if (token.value === '(') {
          const inner = this.parseLevel(0);
          const close = this.peek();
          if (close.type !== 'op' || close.value !== ')') {
            throw new ExprError("Expected ')'", close.pos);
          }
          this.next();
          return inner;
        }
        throw new ExprError(`Unexpected '${token.value}'`, token.pos);
      }
      case 'end':
        throw new ExprError('Unexpected end of expression', token.pos);
    }
  }

  /** `name(arg, ...)`; the name token is consumed, the next token is '('. */
  private parseCall(name: Token): Expr {
    const fn = findFunction(name.value);
    if (!fn) {
      throw new ExprError(`Unknown function '${name.value}'`, name.pos);
    }
    this.next();
    const args: Expr[] = [];
    if (!(this.peek().type === 'op' && this.peek().value === ')')) {
      for (;;) {
        args.push(this.parseLevel(0));
        const sep = this.peek();
        if (sep.type === 'op' && sep.value === ',') {
          this.next();
          continue;
        }
        break;
      }
    }
    const close = this.peek();
    if (close.type !== 'op' || close.value !== ')') {
      throw new ExprError("Expected ',' or ')'", close.pos);
    }
    this.next();
    if (args.length < fn.min || args.length > fn.max) {
      const count = fn.min === fn.max ? `${fn.min}` : `${fn.min} to ${fn.max}`;
      throw new ExprError(
        `Function '${fn.name}' takes ${count} argument${fn.max === 1 ? '' : 's'}, got ${args.length}`,
        name.pos,
      );
    }
    return { type: 'call', name: fn.name, args, pos: name.pos };
  }
}

// ---------- functions ----------

/** Response curve names of `curve(name, x)`, lower case. Input and output are in 0..1. */
export const CURVE_NAMES = [
  'linear',
  'inverseLinear',
  'quadratic',
  'inverseQuadratic',
  'sqrt',
  'inverseSqrt',
  'logistic',
  'inverseLogistic',
  'step',
  'inverseStep',
] as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const CURVES: Record<string, (x: number) => number> = {
  linear: (x) => x,
  inverselinear: (x) => 1 - x,
  quadratic: (x) => x * x,
  inversequadratic: (x) => 1 - x * x,
  sqrt: (x) => Math.sqrt(x),
  inversesqrt: (x) => 1 - Math.sqrt(x),
  // Normalized so that curve(0) = 0 and curve(1) = 1.
  logistic: (x) => logistic01(x),
  inverselogistic: (x) => 1 - logistic01(x),
  step: (x) => (x >= 0.5 ? 1 : 0),
  inversestep: (x) => (x >= 0.5 ? 0 : 1),
};

function logistic01(x: number): number {
  const k = 10;
  const f = (t: number) => 1 / (1 + Math.exp(-k * (t - 0.5)));
  const lo = f(0);
  const hi = f(1);
  return (f(x) - lo) / (hi - lo);
}

/** Value of response curve `name` (case insensitive) at x (clamped to 0..1). Throws for unknown names. */
export function curveValue(name: string, x: number): number {
  const fn = CURVES[name.toLowerCase()];
  if (!fn) {
    throw new Error(`Unknown curve '${name}' (expected one of ${CURVE_NAMES.join(', ')})`);
  }
  return clamp01(fn(clamp01(x)));
}

interface ExprFunction {
  name: string;
  min: number;
  max: number;
  /** Arguments are evaluated before the call. */
  call(args: unknown[], ctx: EvalContext, pos: number): unknown;
}

function num(fn: string, value: unknown, pos: number): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  throw new ExprError(`Function '${fn}' needs numbers, got ${describeValue(value)}`, pos);
}

const math1 = (name: string, f: (x: number) => number): ExprFunction => ({
  name,
  min: 1,
  max: 1,
  call: ([x], _ctx, pos) => f(num(name, x, pos)),
});

/** Functions of the expression language. Names are matched case sensitively. */
export const EXPRESSION_FUNCTIONS: readonly ExprFunction[] = [
  {
    name: 'min',
    min: 1,
    max: Infinity,
    call: (args, _ctx, pos) => Math.min(...args.map((a) => num('min', a, pos))),
  },
  {
    name: 'max',
    min: 1,
    max: Infinity,
    call: (args, _ctx, pos) => Math.max(...args.map((a) => num('max', a, pos))),
  },
  {
    name: 'clamp',
    min: 3,
    max: 3,
    call: ([x, lo, hi], _ctx, pos) =>
      Math.min(Math.max(num('clamp', x, pos), num('clamp', lo, pos)), num('clamp', hi, pos)),
  },
  math1('abs', Math.abs),
  math1('sqrt', Math.sqrt),
  math1('exp', Math.exp),
  math1('log', Math.log),
  math1('floor', Math.floor),
  math1('ceil', Math.ceil),
  math1('round', Math.round),
  {
    name: 'pow',
    min: 2,
    max: 2,
    call: ([x, y], _ctx, pos) => Math.pow(num('pow', x, pos), num('pow', y, pos)),
  },
  {
    // Blackboard value by a key name computed at run time, e.g. get({{Input}}).
    name: 'get',
    min: 1,
    max: 1,
    call: ([key], ctx, pos) => {
      if (typeof key !== 'string') {
        throw new ExprError(`Function 'get' needs a key name, got ${describeValue(key)}`, pos);
      }
      const value = ctx.get(key);
      return value === undefined ? null : value;
    },
  },
  {
    // (x - lo) / (hi - lo), clamped to 0..1.
    name: 'normalize',
    min: 3,
    max: 3,
    call: ([x, lo, hi], _ctx, pos) => {
      const a = num('normalize', lo, pos);
      const b = num('normalize', hi, pos);
      if (a === b) {
        throw new ExprError("Function 'normalize' needs different min and max", pos);
      }
      return clamp01((num('normalize', x, pos) - a) / (b - a));
    },
  },
  {
    name: 'curve',
    min: 2,
    max: 2,
    call: ([name, x], _ctx, pos) => {
      if (typeof name !== 'string') {
        throw new ExprError(`Function 'curve' needs a curve name, got ${describeValue(name)}`, pos);
      }
      try {
        return curveValue(name, num('curve', x, pos));
      } catch (e) {
        if (e instanceof ExprError) throw e;
        throw new ExprError(e instanceof Error ? e.message : String(e), pos);
      }
    },
  },
];

function findFunction(name: string): ExprFunction | undefined {
  return EXPRESSION_FUNCTIONS.find((fn) => fn.name === name);
}

/** Parses an expression. Throws ExprError with the position of the problem. */
export function parseExpression(src: string): Expr {
  if (src.trim() === '') {
    throw new ExprError('Empty expression', 0);
  }
  const parser = new Parser(tokenize(src));
  const expr = parser.parseExpr();
  parser.expectEnd();
  return expr;
}

/** Parses `Key = expr`. Throws ExprError. */
export function parseAssignment(src: string): Assignment {
  const tokens = tokenize(src);
  const first = tokens[0];
  if (first.type !== 'ident' || ['true', 'false', 'null'].includes(first.value)) {
    throw new ExprError('Assignment must start with a blackboard key', first.pos);
  }
  const eq = tokens[1];
  if (eq.type !== 'op' || eq.value !== '=') {
    throw new ExprError("Expected '=' after the blackboard key", eq.pos);
  }
  const parser = new Parser(tokens.slice(2));
  if (tokens[2].type === 'end') {
    throw new ExprError('Missing value after =', tokens[2].pos);
  }
  const expr = parser.parseExpr();
  parser.expectEnd();
  return { target: first.value, expr };
}

/** Truthiness: null, false, 0, NaN and '' are false. */
export function isTruthy(value: unknown): boolean {
  return !(
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === '' ||
    Number.isNaN(value)
  );
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  return typeof value === 'object' ? 'an object' : String(value);
}

function toNumber(value: unknown, op: string, pos: number): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  throw new ExprError(`Operator '${op}' needs numbers, got ${describeValue(value)}`, pos);
}

function looseEquals(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function evalBinary(expr: Extract<Expr, { type: 'binary' }>, ctx: EvalContext): unknown {
  const { op, pos } = expr;
  if (op === '&&') {
    return isTruthy(evaluate(expr.left, ctx)) && isTruthy(evaluate(expr.right, ctx));
  }
  if (op === '||') {
    return isTruthy(evaluate(expr.left, ctx)) || isTruthy(evaluate(expr.right, ctx));
  }
  const left = evaluate(expr.left, ctx);
  const right = evaluate(expr.right, ctx);
  switch (op) {
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return `${left === null || left === undefined ? '' : String(left)}${
          right === null || right === undefined ? '' : String(right)
        }`;
      }
      return toNumber(left, op, pos) + toNumber(right, op, pos);
    case '-':
      return toNumber(left, op, pos) - toNumber(right, op, pos);
    case '*':
      return toNumber(left, op, pos) * toNumber(right, op, pos);
    case '/':
    case '%': {
      const divisor = toNumber(right, op, pos);
      const dividend = toNumber(left, op, pos);
      if (divisor === 0) {
        throw new ExprError('Division by zero', pos);
      }
      return op === '/' ? dividend / divisor : dividend % divisor;
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      let a: number | string;
      let b: number | string;
      if (typeof left === 'string' && typeof right === 'string') {
        a = left;
        b = right;
      } else {
        a = toNumber(left, op, pos);
        b = toNumber(right, op, pos);
      }
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      if (op === '>') return a > b;
      return a >= b;
    }
  }
}

/** Evaluates an expression. Throws ExprError for type errors and division by zero. */
export function evaluate(expr: Expr, ctx: EvalContext): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'ident': {
      const value = ctx.get(expr.name);
      return value === undefined ? null : value;
    }
    case 'prop': {
      const value = ctx.prop(expr.name);
      return value === undefined ? null : value;
    }
    case 'unary': {
      const value = evaluate(expr.operand, ctx);
      return expr.op === '!' ? !isTruthy(value) : -toNumber(value, '-', expr.pos);
    }
    case 'binary':
      return evalBinary(expr, ctx);
    case 'call': {
      const fn = findFunction(expr.name);
      if (!fn) {
        throw new ExprError(`Unknown function '${expr.name}'`, expr.pos);
      }
      return fn.call(
        expr.args.map((arg) => evaluate(arg, ctx)),
        ctx,
        expr.pos,
      );
    }
  }
}

/** Parses and evaluates in one step. Throws ExprError. */
export function evaluateText(src: string, ctx: EvalContext): unknown {
  return evaluate(parseExpression(src), ctx);
}
