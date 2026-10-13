import { describe, expect, it } from 'vitest';
import { createProjectStore, parseScenarios } from './projectStore';

describe('parseScenarios', () => {
  it('returns the valid scenarios of the project text', () => {
    const text = JSON.stringify({
      scenarios: [
        { name: 'A', blackboard: { Ammo: 1 } },
        { name: 'no blackboard' },
        { name: 5, blackboard: {} },
        { name: 'list', blackboard: [] },
        null,
        { name: 'B', description: 'd', blackboard: {} },
      ],
    });
    expect(parseScenarios(text).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('returns nothing for text without scenarios or invalid JSON', () => {
    expect(parseScenarios('{}')).toEqual([]);
    expect(parseScenarios('{"scenarios": 3}')).toEqual([]);
    expect(parseScenarios('nope')).toEqual([]);
  });
});

describe('project store scenarios', () => {
  it('keeps the scenarios of the loaded project text', () => {
    const store = createProjectStore();
    expect(store.getState().scenarios).toEqual([]);
    store.getState().applyContent(JSON.stringify({ scenarios: [{ name: 'A', blackboard: {} }] }));
    expect(store.getState().scenarios).toEqual([{ name: 'A', blackboard: {} }]);
    store.getState().applyContent('{}');
    expect(store.getState().scenarios).toEqual([]);
  });
});
