import { useEffect } from 'react';
import { focusNode } from '../components/TreeCanvas/viewportStore';
import { markTreeDirty } from '../lib/dirtyTrees';
import { parseSelectParam, resolveTreeItemRef } from '../lib/treeLinks';
import { treeStore, useTreeStore } from '../store/treeStore';

/** Delay before panning to the selected item, so the canvas has centered the new tree first. */
const FOCUS_DELAY_MS = 250;

/**
 * Selects the item named by the `select` URL value (see treeLinks) after the first load of the
 * tree, and pans the canvas to it.
 */
export function useSelectFromUrl(select: string | undefined): void {
  const loadCount = useTreeStore((state) => state.loadCount);
  // Only on (re)loads: later edits of the tree must not move the selection back.
  useEffect(() => {
    const ref = parseSelectParam(select);
    const root = treeStore.getState().root;
    if (!ref || !root || loadCount === 0) {
      return undefined;
    }
    const selection = resolveTreeItemRef(root, ref);
    if (!selection) {
      return undefined;
    }
    treeStore.getState().select(selection);
    const timer = window.setTimeout(() => focusNode(selection.nodeId), FOCUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [select, loadCount]);
}

/** Publishes the unsaved state of the open tree to other tabs (see dirtyTrees). */
export function useDirtyTreeBeacon(treePath: string): void {
  const dirty = useTreeStore((state) => state.dirty);
  useEffect(() => {
    markTreeDirty(treePath, dirty);
  }, [treePath, dirty]);
  useEffect(() => {
    const clear = () => markTreeDirty(treePath, false);
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [treePath]);
}
