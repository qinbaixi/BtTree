import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '@owlbt/shared';
import { editSimulate, formatNumberOrTemplate, parseNumberOrTemplate } from './simulation';

describe('number or template fields', () => {
  it('parses numbers and keeps templates as text', () => {
    expect(parseNumberOrTemplate(' 3 ')).toBe(3);
    expect(parseNumberOrTemplate('-1')).toBe(-1);
    expect(parseNumberOrTemplate('2.5')).toBe(2.5);
    expect(parseNumberOrTemplate('{{Duration}}')).toBe('{{Duration}}');
    expect(parseNumberOrTemplate('1 + 2')).toBe('1 + 2');
    expect(parseNumberOrTemplate('  ')).toBeUndefined();
    expect(formatNumberOrTemplate(4)).toBe('4');
    expect(formatNumberOrTemplate('{{A}}')).toBe('{{A}}');
    expect(formatNumberOrTemplate(undefined)).toBe('');
  });
});

describe('editSimulate', () => {
  const file = (): ProjectFile => ({ nodes: [{ name: 'A' }] });

  it('creates, changes and removes simulate settings', () => {
    const draft = file();
    editSimulate(draft, 'node', 'A', (s) => {
      s.mode = 'rule';
      s.duration = 2;
      s.effects = ['X = 1'];
    });
    expect(draft.nodes?.[0].simulate).toEqual({ mode: 'rule', duration: 2, effects: ['X = 1'] });

    editSimulate(draft, 'node', 'A', (s) => {
      s.duration = undefined;
      s.effects = [];
    });
    expect(draft.nodes?.[0].simulate).toEqual({ mode: 'rule' });

    editSimulate(draft, 'node', 'A', (s) => {
      s.mode = undefined;
    });
    expect(draft.nodes?.[0].simulate).toBeUndefined();
    expect(Object.hasOwn(draft.nodes?.[0] ?? {}, 'simulate')).toBe(false);
  });

  it('keeps unknown simulate keys and ignores unknown types', () => {
    const draft: ProjectFile = { nodes: [{ name: 'A', simulate: { custom: 1 } }] };
    editSimulate(draft, 'node', 'A', (s) => {
      s.mode = 'success';
    });
    expect(draft.nodes?.[0].simulate).toEqual({ custom: 1, mode: 'success' });
    expect(() => editSimulate(draft, 'node', 'Missing', () => undefined)).not.toThrow();
  });
});
