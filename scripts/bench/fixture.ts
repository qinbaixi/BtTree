import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compileProject,
  type CompiledProject,
  type ProjectFile,
  type TreeNodeJson,
} from '@owlbt/shared';
import { buildTreeJson as buildTree } from './treeFixture';

export { createRandom } from './treeFixture';

/** The project template shipped with the server: real types, custom types with patterns. */
export const PROJECT_PATH = join(
  import.meta.dirname,
  '../../packages/server/templates/owl-bt.json',
);

export const projectText = readFileSync(PROJECT_PATH, 'utf8');
export const project: CompiledProject = compileProject(JSON.parse(projectText) as ProjectFile);

/** A valid tree of `size` nodes for the template project. */
export function buildTreeJson(size: number, seed = 1): TreeNodeJson {
  return buildTree(project, size, seed);
}
