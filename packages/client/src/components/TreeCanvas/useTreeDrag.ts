import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  findNode,
  findSubItem,
  isNoopNodeDrop,
  isNoopSubItemDrop,
  moveNodeTo,
  moveSubItemTo,
  resolveNodeDrop,
  resolveSubItemDrop,
  type CompiledProject,
  type DropPosition,
  type SubItemKind,
  type TreeNode,
} from '@owlbt/shared';
import { isCompositeNode } from '../../commands/itemTypes';
import { projectStore } from '../../store/projectStore';
import { treeStore, type TreeStore } from '../../store/treeStore';
import type { CanvasController } from './canvasController';

/** Pointer movement (CSS px) after which a press on a node becomes a drag. Smaller = click. */
export const DRAG_THRESHOLD = 5;

/** Part of a card's width (each side) that drops before / after it instead of inside. */
const SIDE_ZONE = 0.25;
/** Gap between a card and the before / after indicator (CSS px). */
const INDICATOR_GAP = 6;
const INDICATOR_SIZE = 3;

export type DragSource =
  { kind: 'node'; nodeId: string } | { kind: SubItemKind; nodeId: string; itemId: string };

/** A rectangle in viewport (client) coordinates. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Result of hovering a drop target: where the indicator goes and how to apply the drop. */
export type DropPlan =
  | { valid: false }
  | {
      valid: true;
      /** 'line' for before / after, 'box' for into a node. */
      indicator: 'line' | 'box';
      rect: ClientRect;
      commit(tree: TreeStore): void;
    };

/** What the canvas renders while dragging. */
export interface DragView {
  source: DragSource;
  /** Indicator relative to the canvas container; undefined when there is no (valid) target. */
  indicator?: { kind: 'line' | 'box'; rect: ClientRect };
  /** The pointer is over a target that does not accept the item. */
  invalid: boolean;
}

/** Hit test of the viewport point (document.elementFromPoint by default). */
export type HitTest = (clientX: number, clientY: number) => Element | null;

const defaultHitTest: HitTest = (x, y) =>
  typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;

/**
 * The item a press on `target` would drag: a decorator / service row, or the node card.
 * Undefined for buttons inside the card, the root node card and anything outside a card.
 */
export function dragSourceOf(
  target: EventTarget | null,
  root: TreeNode | undefined,
): DragSource | undefined {
  if (!root || !(target instanceof Element) || target.closest('button, input, select, textarea')) {
    return undefined;
  }
  const card = target.closest<HTMLElement>('[data-node-id]');
  const nodeId = card?.dataset.nodeId;
  if (!card || nodeId === undefined) {
    return undefined;
  }
  const row = target.closest<HTMLElement>('[data-item-id]');
  const kind = row?.dataset.itemKind;
  const itemId = row?.dataset.itemId;
  if (row && card.contains(row) && itemId && (kind === 'decorator' || kind === 'service')) {
    return { kind, nodeId, itemId };
  }
  return nodeId === root.id ? undefined : { kind: 'node', nodeId };
}

function rectOf(element: Element): ClientRect {
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function nodePosition(
  rect: ClientRect,
  clientX: number,
  composite: boolean,
  isRoot: boolean,
): DropPosition {
  if (isRoot) {
    return 'inside';
  }
  const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  if (!composite) {
    return ratio < 0.5 ? 'before' : 'after';
  }
  if (ratio < SIDE_ZONE) {
    return 'before';
  }
  return ratio > 1 - SIDE_ZONE ? 'after' : 'inside';
}

function planNodeDrop(
  source: Extract<DragSource, { kind: 'node' }>,
  card: HTMLElement,
  clientX: number,
  root: TreeNode,
  project: CompiledProject | undefined,
): DropPlan | undefined {
  const target = findNode(root, card.dataset.nodeId ?? '');
  const dragged = findNode(root, source.nodeId);
  if (!target || !dragged) {
    return undefined;
  }
  const rect = rectOf(card);
  const isComposite = (node: TreeNode): boolean => isCompositeNode(project, node);
  const position = nodePosition(rect, clientX, isComposite(target), target.id === root.id);
  const drop = resolveNodeDrop(root, source.nodeId, target.id, position, isComposite);
  if (!drop) {
    // Hovering the dragged card itself is neutral, not "not allowed".
    return target.id === source.nodeId ? undefined : { valid: false };
  }
  if (isNoopNodeDrop(root, source.nodeId, drop)) {
    return undefined;
  }
  let indicatorRect: ClientRect;
  if (position === 'inside') {
    indicatorRect = {
      left: rect.left - 4,
      top: rect.top - 4,
      width: rect.width + 8,
      height: rect.height + 8,
    };
  } else {
    const x =
      position === 'before'
        ? rect.left - INDICATOR_GAP - INDICATOR_SIZE
        : rect.left + rect.width + INDICATOR_GAP;
    indicatorRect = { left: x, top: rect.top, width: INDICATOR_SIZE, height: rect.height };
  }
  const nodeId = source.nodeId;
  return {
    valid: true,
    indicator: position === 'inside' ? 'box' : 'line',
    rect: indicatorRect,
    commit(tree) {
      tree
        .getState()
        .apply(`Move ${dragged.type}`, (draft) => void moveNodeTo(draft, nodeId, drop), {
          kind: 'node',
          nodeId,
        });
    },
  };
}

/** Bottom edge of the row after which an item of `kind` is appended in `card`. */
function appendLineTop(card: HTMLElement, kind: SubItemKind): number {
  const selectors =
    kind === 'decorator'
      ? ['[data-item-kind="decorator"]', '[data-item-kind="node"]']
      : ['[data-item-kind="service"]', '[data-item-kind="decorator"]', '[data-item-kind="node"]'];
  for (const selector of selectors) {
    const rows = card.querySelectorAll(selector);
    const last = rows[rows.length - 1];
    if (last) {
      const r = rectOf(last);
      return r.top + r.height;
    }
  }
  const r = rectOf(card);
  return r.top + r.height;
}

function planSubItemDrop(
  source: Extract<DragSource, { kind: SubItemKind }>,
  hit: Element,
  card: HTMLElement,
  clientY: number,
  root: TreeNode,
): DropPlan | undefined {
  const { kind, itemId } = source;
  const fromNode = findNode(root, source.nodeId);
  const item = fromNode ? findSubItem(fromNode, kind, itemId) : undefined;
  if (!item) {
    return undefined;
  }
  const targetNodeId = card.dataset.nodeId ?? '';
  const row = hit.closest<HTMLElement>(`[data-item-kind="${kind}"][data-item-id]`);
  const cardRect = rectOf(card);
  let drop;
  let lineTop: number;
  if (row && card.contains(row)) {
    const r = rectOf(row);
    const position = clientY < r.top + r.height / 2 ? 'before' : 'after';
    drop = resolveSubItemDrop(root, kind, targetNodeId, row.dataset.itemId, position);
    lineTop = position === 'before' ? r.top : r.top + r.height;
  } else {
    drop = resolveSubItemDrop(root, kind, targetNodeId, undefined, 'after');
    lineTop = appendLineTop(card, kind);
  }
  if (!drop) {
    return { valid: false };
  }
  if (isNoopSubItemDrop(root, kind, source.nodeId, itemId, drop)) {
    return undefined;
  }
  const fromNodeId = source.nodeId;
  const target = drop;
  return {
    valid: true,
    indicator: 'line',
    rect: {
      left: cardRect.left,
      top: lineTop - INDICATOR_SIZE / 2,
      width: cardRect.width,
      height: INDICATOR_SIZE,
    },
    commit(tree) {
      tree
        .getState()
        .apply(
          `Move ${item.type}`,
          (draft) => void moveSubItemTo(draft, kind, fromNodeId, itemId, target),
          { kind, nodeId: target.nodeId, itemId },
        );
    },
  };
}

/**
 * Plans dropping `source` on the element `hit` at the given viewport point.
 * Undefined means no target (background, or a drop that would change nothing).
 */
export function planDrop(
  source: DragSource,
  hit: Element | null,
  clientX: number,
  clientY: number,
  root: TreeNode,
  project: CompiledProject | undefined,
): DropPlan | undefined {
  const card = hit?.closest<HTMLElement>('[data-node-id]');
  if (!hit || !card) {
    return undefined;
  }
  return source.kind === 'node'
    ? planNodeDrop(source, card, clientX, root, project)
    : planSubItemDrop(source, hit, card, clientY, root);
}

function sourceElement(target: Element, source: DragSource): HTMLElement | null {
  return source.kind === 'node'
    ? target.closest<HTMLElement>('[data-node-id]')
    : target.closest<HTMLElement>('[data-item-id]');
}

export interface TreeDragOptions {
  controller: CanvasController;
  /** The canvas container: indicator rectangles are relative to it. */
  containerRef: RefObject<HTMLElement | null>;
  /** False in run mode (read-only tree): presses never start a drag. */
  enabled: boolean;
  tree?: TreeStore;
  hitTest?: HitTest;
}

/**
 * Drag and drop of nodes, decorators and services on the tree canvas. Returns the pointerdown
 * handler for the canvas and the current drag (for the indicator). A press only becomes a drag
 * after DRAG_THRESHOLD px, so clicks still select. One drop is one undoable step. Escape cancels.
 */
export function useTreeDrag({
  controller,
  containerRef,
  enabled,
  tree = treeStore,
  hitTest = defaultHitTest,
}: TreeDragOptions): {
  drag: DragView | undefined;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const [drag, setDrag] = useState<DragView | undefined>(undefined);
  const enabledRef = useRef(enabled);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      cleanupRef.current?.();
    }
  }, [enabled]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabledRef.current || event.button !== 0 || cleanupRef.current) {
        return;
      }
      const source = dragSourceOf(event.target, tree.getState().root);
      if (!source || !(event.target instanceof Element)) {
        return;
      }
      const element = sourceElement(event.target, source);
      const originX = event.clientX;
      const originY = event.clientY;
      let started = false;
      let plan: DropPlan | undefined;

      const update = (clientX: number, clientY: number): void => {
        const root = tree.getState().root;
        plan = root
          ? planDrop(
              source,
              hitTest(clientX, clientY),
              clientX,
              clientY,
              root,
              projectStore.getState().project,
            )
          : undefined;
        const origin = containerRef.current?.getBoundingClientRect();
        const toLocal = (rect: ClientRect): ClientRect => ({
          ...rect,
          left: rect.left - (origin?.left ?? 0),
          top: rect.top - (origin?.top ?? 0),
        });
        setDrag({
          source,
          indicator: plan?.valid ? { kind: plan.indicator, rect: toLocal(plan.rect) } : undefined,
          invalid: plan !== undefined && !plan.valid,
        });
      };

      const onMove = (moveEvent: PointerEvent): void => {
        if (!started) {
          if (
            Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < DRAG_THRESHOLD
          ) {
            return;
          }
          started = true;
          controller.markMoved();
          // Without d3-zoom handling the press, the browser may have started a text selection.
          window.getSelection()?.removeAllRanges();
          if (element) {
            element.dataset.dragging = 'true';
          }
        }
        update(moveEvent.clientX, moveEvent.clientY);
      };

      function finish(commit: boolean): void {
        const finalPlan = plan;
        cleanup();
        if (commit && started && finalPlan?.valid && enabledRef.current) {
          finalPlan.commit(tree);
        }
      }
      function onUp(): void {
        finish(true);
      }
      function onCancel(): void {
        finish(false);
      }
      function onKeyDown(keyEvent: KeyboardEvent): void {
        if (keyEvent.key === 'Escape' && started) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          finish(false);
        }
      }
      function cleanup(): void {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown, true);
        if (element) {
          delete element.dataset.dragging;
        }
        cleanupRef.current = undefined;
        if (started) {
          setDrag(undefined);
        }
      }

      cleanupRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown, true);
    },
    [containerRef, controller, hitTest, tree],
  );

  return { drag, onPointerDown };
}
