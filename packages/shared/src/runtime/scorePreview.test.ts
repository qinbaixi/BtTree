import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { previewScore } from './scorePreview';

const project = compileProject({
  decorators: [
    {
      name: 'Consideration',
      properties: [
        { name: 'Input', type: 'string', default: 'Health' },
        { name: 'Min', type: 'number', default: 0 },
        { name: 'Max', type: 'number', default: 100 },
        { name: 'Curve', type: 'enum', values: ['Linear', 'InverseLinear'], default: 'Linear' },
      ],
      simulate: { score: 'curve({{Curve}}, normalize(get({{Input}}), {{Min}}, {{Max}}))' },
    },
    { name: 'Raw', simulate: { score: 'Hunger * 2' } },
    { name: 'Constant', simulate: { score: 0.5 } },
    { name: 'Weight', simulate: { score: '{{W}}' } },
    { name: 'Broken', simulate: { score: 'curve(' } },
  ],
});

describe('previewScore', () => {
  it('samples a consideration over its Min..Max range', () => {
    const preview = previewScore(project.decorators.Consideration, { Curve: 'InverseLinear' }, 4)!;
    expect(preview.min).toBe(0);
    expect(preview.max).toBe(100);
    expect(preview.points).toEqual([
      [0, 1],
      [25, 0.75],
      [50, 0.5],
      [75, 0.25],
      [100, 0],
    ]);
  });

  it('draws the curve while the input key is still empty', () => {
    const empty = compileProject({
      decorators: [
        {
          name: 'Consideration',
          properties: [
            { name: 'Input', type: 'string' },
            { name: 'Min', type: 'number', default: 0 },
            { name: 'Max', type: 'number', default: 100 },
          ],
          simulate: { score: "curve('quadratic', normalize(get({{Input}}), {{Min}}, {{Max}}))" },
        },
      ],
    }).decorators.Consideration;
    for (const properties of [{}, { Input: '' }]) {
      const preview = previewScore(empty, properties, 2)!;
      expect(preview.points).toEqual([
        [0, 0],
        [50, 0.25],
        [100, 1],
      ]);
    }
  });

  it('uses 0..1 without a Min / Max range', () => {
    const preview = previewScore(project.decorators.Raw, {}, 2)!;
    expect(preview.points).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 2],
    ]);
  });

  it('gives nothing for scores that do not read the blackboard or do not parse', () => {
    expect(previewScore(project.decorators.Constant, {})).toBeUndefined();
    expect(previewScore(project.decorators.Weight, {})).toBeUndefined();
    expect(previewScore(project.decorators.Broken, {})).toBeUndefined();
  });
});
