import { createStore } from 'zustand/vanilla';

export interface ViewportState {
  /** Increments on every focus request so repeated requests for the same node are honored. */
  focusSeq: number;
  focusNodeId?: string;
  /** Pans the tree canvas (animated) so that the node is in view. */
  focusNode(nodeId: string): void;
}

/** Requests from commands (e.g. "select next") to move the open tree canvas. */
export const viewportStore = createStore<ViewportState>()((set) => ({
  focusSeq: 0,
  focusNode(nodeId) {
    set((state) => ({ focusSeq: state.focusSeq + 1, focusNodeId: nodeId }));
  },
}));

export function focusNode(nodeId: string): void {
  viewportStore.getState().focusNode(nodeId);
}

/** Pan and zoom of the tree canvas (d3 zoom transform values). */
export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** Transform of the mounted canvas; undefined until it was positioned. Not reactive (changes per frame). */
let currentTransform: ViewTransform | undefined;
/** Transform the next canvas of `treePath` starts with instead of centering the root. */
let pendingTransform: { treePath: string; transform: ViewTransform } | undefined;

export function reportViewTransform(transform: ViewTransform | undefined): void {
  currentTransform = transform;
}

export function getViewTransform(): ViewTransform | undefined {
  return currentTransform;
}

/** Makes the next canvas that shows `treePath` restore the transform (editor tabs). */
export function requestViewTransform(treePath: string, transform: ViewTransform | undefined): void {
  pendingTransform = transform ? { treePath, transform } : undefined;
}

/** Returns and clears the requested transform when it is for `treePath`. */
export function takeViewTransform(treePath: string | undefined): ViewTransform | undefined {
  const pending = pendingTransform;
  if (!pending || pending.treePath !== treePath) {
    return undefined;
  }
  pendingTransform = undefined;
  return pending.transform;
}
