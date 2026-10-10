import { describe, expect, it } from 'vitest';
import {
  csharpClassName,
  csharpIdentifier,
  csharpString,
  parseCsNamespace,
  tsKey,
  tsString,
} from './names';

describe('tsString', () => {
  it('wraps the text in single quotes and escapes quotes and backslashes', () => {
    expect(tsString('plain')).toBe("'plain'");
    expect(tsString("it's")).toBe("'it\\'s'");
    expect(tsString('a\\b')).toBe("'a\\\\b'");
    expect(tsString('"double"')).toBe('\'"double"\'');
  });

  it('escapes control characters', () => {
    expect(tsString('a\nb\rc\td')).toBe("'a\\nb\\rc\\td'");
    expect(tsString('\u0001\u001f\u007f')).toBe("'\\u0001\\u001f\\u007f'");
  });
});

describe('tsKey', () => {
  it('leaves identifiers bare, quotes everything else', () => {
    expect(tsKey('node_id')).toBe('node_id');
    expect(tsKey('$x')).toBe('$x');
    expect(tsKey('end')).toBe('end');
    expect(tsKey('with space')).toBe("'with space'");
    expect(tsKey('1st')).toBe("'1st'");
    expect(tsKey("it's")).toBe("'it\\'s'");
  });
});

describe('csharpString', () => {
  it('wraps the text in double quotes and escapes quotes and backslashes', () => {
    expect(csharpString('plain')).toBe('"plain"');
    expect(csharpString('say "hi"')).toBe('"say \\"hi\\""');
    expect(csharpString('a\\b')).toBe('"a\\\\b"');
    expect(csharpString("it's")).toBe('"it\'s"');
  });

  it('escapes newlines, tabs and other control characters', () => {
    expect(csharpString('a\nb\rc\td')).toBe('"a\\nb\\rc\\td"');
    expect(csharpString('\u0001\u001f')).toBe('"\\u0001\\u001f"');
  });
});

describe('csharpIdentifier', () => {
  it('removes characters that are not allowed in identifiers', () => {
    expect(csharpIdentifier('Bt-Mon 1000')).toBe('BtMon1000');
  });

  it('prefixes a leading digit with an underscore', () => {
    expect(csharpIdentifier('1000')).toBe('_1000');
  });

  it('uses an underscore when nothing is left', () => {
    expect(csharpIdentifier('-- ')).toBe('_');
  });

  it('prefixes C# keywords with @', () => {
    expect(csharpIdentifier('class')).toBe('@class');
    expect(csharpIdentifier('@class')).toBe('@class');
    expect(csharpIdentifier('Class')).toBe('Class');
  });
});

describe('csharpClassName', () => {
  it('converts file names to PascalCase', () => {
    expect(csharpClassName('bt_mon_1000')).toBe('BtMon1000');
    expect(csharpClassName('bt-mon 1000')).toBe('BtMon1000');
    expect(csharpClassName('patrol')).toBe('Patrol');
    expect(csharpClassName('HTTPServer')).toBe('HTTPServer');
  });

  it('prefixes names that start with a digit', () => {
    expect(csharpClassName('1_patrol')).toBe('_1Patrol');
  });

  it('falls back to BehaviorTree when no letters or digits are left', () => {
    expect(csharpClassName('---')).toBe('BehaviorTree');
  });

  it('escapes keywords', () => {
    expect(csharpClassName('class')).toBe('Class');
    expect(csharpClassName('@class')).toBe('Class');
  });
});

describe('parseCsNamespace', () => {
  it('uses BehaviorTrees when there is no setting', () => {
    expect(parseCsNamespace(undefined)).toEqual({ namespace: 'BehaviorTrees' });
  });

  it('accepts dotted identifiers', () => {
    expect(parseCsNamespace('Game.Ai_2')).toEqual({ namespace: 'Game.Ai_2' });
    expect(parseCsNamespace('Mon')).toEqual({ namespace: 'Mon' });
  });

  it('falls back to the default with a warning for anything else', () => {
    for (const bad of ['', '1Game', 'Game..Ai', 'Game.', 'my game', 'class.Ai', 42, null]) {
      const result = parseCsNamespace(bad);
      expect(result.namespace).toBe('BehaviorTrees');
      expect(result.warning).toBe(
        `Invalid C# namespace ${JSON.stringify(bad)}, using BehaviorTrees`,
      );
    }
  });
});
