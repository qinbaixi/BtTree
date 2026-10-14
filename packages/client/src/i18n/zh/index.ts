import type { Dictionary } from '..';
import { common } from './common';
import { editor } from './editor';
import { panels } from './panels';
import { projectEditor } from './projectEditor';

/**
 * Chinese texts by English key. Each area of the UI has its own file so that they can be edited
 * independently; later files win on duplicate keys, so keep a key in one file only.
 */
export const zh: Dictionary = {
  ...common,
  ...editor,
  ...panels,
  ...projectEditor,
};
