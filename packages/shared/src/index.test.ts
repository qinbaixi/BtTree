import { describe, expect, it } from 'vitest';
import { VERSION } from './index';

describe('@owlbt/shared', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('0.3.0');
  });
});
