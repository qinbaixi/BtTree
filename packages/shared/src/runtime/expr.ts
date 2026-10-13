/*
 * Tiny expression language of the run mode simulator. No eval / Function: a hand written tokenizer,
 * a recursive descent parser and a tree-walking evaluator.
 *
 *   literals      numbers, 'strings' or "strings", true, false, null
 *   identifiers   blackboard keys (a missing key is null)
 *   {{Prop}}      effective property value of the node / decorator / service that owns the expression
 *   operators     unary - !   * / %   + -   < <= > >=   == !=   &&   ||   and parentheses
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
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number };

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
  }
}

/** Parses and evaluates in one step. Throws ExprError. */
export function evaluateText(src: string, ctx: EvalContext): unknown {
  return evaluate(parseExpression(src), ctx);
}
