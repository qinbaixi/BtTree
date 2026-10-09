import { describe, expect, it } from 'vitest';
import { describeItem } from './describe';
import type { CompiledItemType } from './types';

function itemType(overrides: Partial<CompiledItemType> = {}): CompiledItemType {
  return {
    kind: 'node',
    name: 'Wait',
    color: '#000',
    isComposite: false,
    properties: [
      { name: 'Time', type: 'number', default: 1 },
      { name: 'Name', type: 'string' },
      { name: 'Flag', type: 'bool', default: false },
    ],
    ...overrides,
  };
}

describe('describeItem', () => {
  it('returns undefined when the type has no description', () => {
    expect(describeItem(itemType(), {})).toBeUndefined();
  });

  it('returns undefined for an empty description (as the original editor does)', () => {
    expect(describeItem(itemType({ description: '' }), {})).toBeUndefined();
  });

  it('replaces placeholders with explicit values', () => {
    const type = itemType({ description: 'Wait {{ Time }} seconds' });
    expect(describeItem(type, { Time: 5 })).toBe('Wait 5 seconds');
  });

  it('uses the default value for unset properties', () => {
    const type = itemType({ description: 'Wait {{ Time }}' });
    expect(describeItem(type, {})).toBe('Wait 1');
  });

  it('tolerates whitespace inside the braces', () => {
    const type = itemType({ description: '{{Name}} | {{  Name  }} | {{\tName\t}}' });
    expect(describeItem(type, { Name: 'x' })).toBe('x | x | x');
  });

  it('renders null and undefined values as empty text', () => {
    const type = itemType({ description: '[{{ Name }}]' });
    expect(describeItem(type, { Name: null })).toBe('[]');
    expect(describeItem(type, {})).toBe('[]');
  });

  it('renders 0 and false explicitly', () => {
    const type = itemType({ description: '{{ Time }} {{ Flag }}' });
    expect(describeItem(type, { Time: 0, Flag: false })).toBe('0 false');
  });

  it('uses explicit values of properties not declared by the type', () => {
    const type = itemType({ description: 'Hi {{ Extra }}' });
    expect(describeItem(type, { Extra: 'there' })).toBe('Hi there');
  });

  it('renders unknown placeholders without values as empty text', () => {
    const type = itemType({ description: 'a{{ Missing }}b' });
    expect(describeItem(type, {})).toBe('ab');
  });

  it('does not evaluate expressions', () => {
    const type = itemType({ description: 'x{{ 1 + 1 }}y {{ Time * 2 }}z' });
    expect(describeItem(type, { Time: 3 })).toBe('xy z');
  });

  it('does not expose prototype members', () => {
    const type = itemType({ description: '{{ constructor }}' });
    expect(describeItem(type, {})).toBe('');
  });

  it('replaces every placeholder occurrence', () => {
    const type = itemType({ description: '{{ Name }}-{{ Name }}' });
    expect(describeItem(type, { Name: 'ab' })).toBe('ab-ab');
  });

  it('keeps text without placeholders unchanged', () => {
    const type = itemType({ description: 'plain text {single} braces' });
    expect(describeItem(type, {})).toBe('plain text {single} braces');
  });
});
