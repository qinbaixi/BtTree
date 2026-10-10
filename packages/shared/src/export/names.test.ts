import { describe, expect, it } from 'vitest';
import {
  erlangAtom,
  erlangString,
  luaKey,
  luaString,
  sanitizeModuleName,
  snakeCase,
} from './names';

describe('snakeCase', () => {
  it('converts type names to snake_case', () => {
    expect(snakeCase('RandomSelector')).toBe('random_selector');
    expect(snakeCase('Sequence')).toBe('sequence');
    expect(snakeCase('HTTPServer')).toBe('http_server');
    expect(snakeCase('Wait 2s')).toBe('wait_2s');
    expect(snakeCase('task-10')).toBe('task_10');
    expect(snakeCase('  Walk  ')).toBe('walk');
  });
});

describe('erlangAtom', () => {
  it('leaves plain lowercase atoms unquoted', () => {
    expect(erlangAtom('selector')).toBe('selector');
    expect(erlangAtom('node_id')).toBe('node_id');
    expect(erlangAtom('a1')).toBe('a1');
  });

  it('quotes everything else, including reserved words', () => {
    expect(erlangAtom('Like This')).toBe("'Like This'");
    expect(erlangAtom('Upper')).toBe("'Upper'");
    expect(erlangAtom('1abc')).toBe("'1abc'");
    expect(erlangAtom('end')).toBe("'end'");
    expect(erlangAtom("it's")).toBe(String.raw`'it\'s'`);
    expect(erlangAtom('a\\b')).toBe(String.raw`'a\\b'`);
    expect(erlangAtom('x\ny')).toBe(String.raw`'x\ny'`);
    expect(erlangAtom('x\u0001')).toBe(String.raw`'x\x{1}'`);
  });
});

describe('erlangString', () => {
  it('wraps text in a utf8 binary and escapes it', () => {
    expect(erlangString('hi')).toBe('<<"hi"/utf8>>');
    expect(erlangString('say "x"\\')).toBe(String.raw`<<"say \"x\"\\"/utf8>>`);
    expect(erlangString('a\nb\tc\rd')).toBe(String.raw`<<"a\nb\tc\rd"/utf8>>`);
    expect(erlangString('\u0001')).toBe(String.raw`<<"\x{1}"/utf8>>`);
    expect(erlangString('中文')).toBe('<<"中文"/utf8>>');
  });
});

describe('luaString and luaKey', () => {
  it('escapes Lua strings with decimal escapes for control characters', () => {
    expect(luaString('hi')).toBe('"hi"');
    expect(luaString('a"b\\c')).toBe(String.raw`"a\"b\\c"`);
    expect(luaString('a\nb\tc\rd')).toBe(String.raw`"a\nb\tc\rd"`);
    expect(luaString('\u0001')).toBe(String.raw`"\001"`);
  });

  it('uses bare keys for identifiers and brackets otherwise', () => {
    expect(luaKey('node_id')).toBe('node_id');
    expect(luaKey('_x9')).toBe('_x9');
    expect(luaKey('end')).toBe('["end"]');
    expect(luaKey('with space')).toBe('["with space"]');
    expect(luaKey('9lives')).toBe('["9lives"]');
  });
});

describe('sanitizeModuleName', () => {
  it('lower cases and replaces characters outside [a-z0-9_]', () => {
    expect(sanitizeModuleName('BT-Mon.1000')).toBe('bt_mon_1000');
    expect(sanitizeModuleName('bt_mon_1000')).toBe('bt_mon_1000');
  });

  it('prefixes names that do not start with a letter', () => {
    expect(sanitizeModuleName('1000')).toBe('m_1000');
    expect(sanitizeModuleName('_tree')).toBe('m__tree');
  });
});
