import { cleanup, render } from '@testing-library/react';
import { compileProject } from '@owlbt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ScorePreview } from './ScorePreview';

const project = compileProject({
  decorators: [
    {
      name: 'Consideration',
      properties: [
        { name: 'Input', type: 'string', default: 'Health' },
        { name: 'Min', type: 'number', default: 0 },
        { name: 'Max', type: 'number', default: 200 },
      ],
      simulate: { score: 'normalize(get({{Input}}), {{Min}}, {{Max}})' },
    },
    { name: 'Weight', simulate: { score: 2 } },
  ],
});

describe('ScorePreview', () => {
  afterEach(cleanup);

  it('draws the score curve over the Min..Max range', () => {
    const { container } = render(
      <ScorePreview type={project.decorators.Consideration} properties={{}} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe('Score from 0 to 200 of the blackboard input');
    const points = container.querySelector('polyline')?.getAttribute('points')?.split(' ');
    expect(points).toHaveLength(41);
    expect(container.textContent).toContain('200');
  });

  it('renders nothing for a constant score', () => {
    const { container } = render(<ScorePreview type={project.decorators.Weight} properties={{}} />);
    expect(container.innerHTML).toBe('');
  });
});
