/**
 * Cost of a selection change on a large tree canvas (jsdom): render time and the number of node
 * size reads (offsetWidth/offsetHeight, each a forced synchronous reflow in a browser).
 *
 *   BENCH=1 npx vitest run src/components/TreeCanvas/TreeCanvas.perf.test.tsx   (in packages/client)
 *
 * Skipped in normal test runs.
 */
import { act, render } from '@testing-library/react';
import {
  compileProject,
  createIdGen,
  forEachNode,
  nodeFromJson,
  type ProjectFile,
  type TreeNode,
} from '@owlbt/shared';
import { describe, it } from 'vitest';
import { buildTreeJson } from '../../../../../scripts/bench/treeFixture';
import projectJson from '../../../../server/templates/owl-bt.json';
import { projectStore } from '../../store/projectStore';
import { treeStore } from '../../store/treeStore';
import TreeCanvas from './TreeCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let sizeReads = 0;
for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get() {
      sizeReads++;
      return 100;
    },
  });
}

const SIZE = 1000;
const RUNS = 50;
const project = compileProject(projectJson as ProjectFile);

describe.skipIf(!import.meta.env.BENCH)('TreeCanvas performance', () => {
  it(`selection changes on a ${SIZE} node tree`, () => {
    const root: TreeNode = nodeFromJson(buildTreeJson(project, SIZE), createIdGen('b'));
    const ids: string[] = [];
    forEachNode(root, (node) => ids.push(node.id));

    projectStore.setState({ project });
    treeStore.setState({ root, selection: undefined });
    render(<TreeCanvas />);

    const select = (index: number): void => {
      act(() => {
        treeStore.getState().select({ kind: 'node', nodeId: ids[(index * 37) % ids.length] });
      });
    };
    for (let i = 0; i < 5; i++) select(i);

    sizeReads = 0;
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      select(i);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      `| Selection change, ${ids.length} nodes (jsdom) | ${times[RUNS >> 1].toFixed(3)} ms | ` +
        `${(sizeReads / RUNS).toFixed(0)} size reads |`,
    );
  }, 120_000);
});
