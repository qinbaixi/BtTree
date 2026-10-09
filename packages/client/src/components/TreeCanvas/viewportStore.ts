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
