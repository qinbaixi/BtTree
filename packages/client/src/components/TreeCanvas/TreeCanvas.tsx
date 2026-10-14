import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import 'd3-transition';
import { select } from 'd3-selection';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
import {
  countDescendants,
  forEachNode,
  searchTree,
  selectionKey,
  type CompiledProject,
  type Selection,
  type TreeNode,
} from '@owlbt/shared';
import { buildExportIdMap } from '../RunMode/runHelpers';
import { connectCollapse, useCollapsed } from '../../store/collapseStore';
import { inspectStore } from '../../store/inspectStore';
import { useProjectStore } from '../../store/projectStore';
import { selectViewed, useRunStore } from '../../store/runStore';
import { useSearchStore } from '../../store/searchStore';
import { useRunViewStore } from '../../store/runViewStore';
import { treeStore, useTreeStore } from '../../store/treeStore';
import { CanvasController, TreeCanvasContext, type ContextMenuHandler } from './canvasController';
import { computeTreeLayout, linkPath, MIN_CANVAS_SIZE, type Size, type TreeLayout } from './layout';
import { TreeNodeView } from './TreeNodeView';
import TreeSearch from './TreeSearch';
import { dragSourceOf, useTreeDrag } from './useTreeDrag';
import { viewportStore } from './viewportStore';
import styles from './TreeCanvas.module.css';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const FOCUS_MOVE_DURATION = 300;
/** Spacing of the background dot grid at zoom 1 (CSS px). Matches TreeCanvas.module.css. */
const GRID_SIZE = 16;
/** Distance from the top of the canvas to a focused node. */
export const FOCUS_TOP_OFFSET = 100;

export interface TreeCanvasProps {
  /**
   * Called on right click after the item was selected. `undefined` means the background was
   * clicked (selection cleared). clientX and clientY are viewport coordinates of the event.
   */
  onContextMenu?: ContextMenuHandler;
}

function sameSizes(a: ReadonlyMap<string, Size>, b: ReadonlyMap<string, Size>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [id, size] of b) {
    const prev = a.get(id);
    if (!prev || prev.width !== size.width || prev.height !== size.height) {
      return false;
    }
  }
  return true;
}

function statusMessage(
  root: TreeNode | undefined,
  treeError: string | undefined,
  hasProject: boolean,
  projectError: string | undefined,
): string | undefined {
  if (!root) {
    return treeError ? `Failed to load tree: ${treeError}` : 'Loading tree...';
  }
  if (!hasProject) {
    return projectError ? `Project not loaded: ${projectError}` : 'Loading project...';
  }
  return undefined;
}

export default function TreeCanvas({ onContextMenu }: TreeCanvasProps) {
  const root = useTreeStore((state) => state.root);
  const treeError = useTreeStore((state) => state.error);
  const selection = useTreeStore((state) => state.selection);
  const project = useProjectStore((state) => state.project);
  const projectError = useProjectStore((state) => state.error);
  const runActive = useRunStore((state) => state.active);
  const viewed = useRunStore(selectViewed);
  const breakpoints = useRunStore((state) => state.breakpoints);
  const showIds = useRunViewStore((state) => state.showIds);
  const collapsed = useCollapsed();
  const searchOpen = useSearchStore((state) => state.open);
  const searchQuery = useSearchStore((state) => state.query);
  const searchIndex = useSearchStore((state) => state.index);

  const [controller] = useState(() => new CanvasController());
  const [sizes, setSizes] = useState<Map<string, Size>>(() => new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown>>(undefined);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const layoutRef = useRef<TreeLayout>(undefined);
  const centeredRef = useRef(false);
  const measuredRef = useRef<{ root?: TreeNode; project?: CompiledProject; layout?: TreeLayout }>(
    {},
  );
  /** Node to center once it is laid out (e.g. a focus request that first had to expand it). */
  const pendingFocusRef = useRef<string | undefined>(undefined);
  const dragEnabledRef = useRef(!runActive);

  const { drag, onPointerDown: onDragPointerDown } = useTreeDrag({
    controller,
    containerRef,
    enabled: !runActive,
  });

  useEffect(() => {
    dragEnabledRef.current = !runActive;
  }, [runActive]);

  // Collapse state: restored per tree, persisted, and expanded when the selection moves inside.
  useEffect(() => connectCollapse(treeStore), []);

  const exportIds = useMemo(
    () => (runActive && showIds ? buildExportIdMap(root) : undefined),
    [runActive, showIds, root],
  );

  const layout = useMemo(
    () => (root ? computeTreeLayout(root, sizes, collapsed) : undefined),
    [root, sizes, collapsed],
  );

  /** Number of hidden descendants of each collapsed node. */
  const hiddenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (root) {
      forEachNode(root, (node) => {
        if (collapsed.has(node.id) && node.childNodes.length > 0) {
          counts.set(node.id, countDescendants(node));
        }
      });
    }
    return counts;
  }, [root, collapsed]);

  const searchMatches = useMemo(
    () => (root && searchOpen ? searchTree(root, searchQuery) : []),
    [root, searchOpen, searchQuery],
  );
  const searchHits = useMemo(
    () => (searchMatches.length > 0 ? new Set(searchMatches.map(selectionKey)) : undefined),
    [searchMatches],
  );
  const currentMatch = searchMatches[searchIndex] as Selection | undefined;

  const nodes = useMemo(() => {
    const list: TreeNode[] = [];
    if (root) {
      forEachNode(root, (node) => list.push(node));
    }
    return list;
  }, [root]);

  const centerOn = useCallback((nodeId: string, duration = 0) => {
    const container = containerRef.current;
    const behavior = zoomRef.current;
    const position = layoutRef.current?.nodes.get(nodeId);
    if (!container || !behavior || !position) {
      // Not laid out yet (e.g. inside a branch that is being expanded): center it later.
      pendingFocusRef.current = nodeId;
      return;
    }
    pendingFocusRef.current = undefined;
    const k = transformRef.current.k;
    const target = zoomIdentity
      .translate(
        container.clientWidth / 2 - k * (position.x + position.width / 2),
        FOCUS_TOP_OFFSET - k * position.y,
      )
      .scale(k);
    const containerSelection = select(container);
    if (duration > 0) {
      containerSelection.transition().duration(duration).call(behavior.transform, target);
    } else {
      containerSelection.call(behavior.transform, target);
    }
  }, []);

  // Pan/zoom. The transform is written straight to the DOM (not React state) to keep zooming cheap.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      return undefined;
    }
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      // d3's default filter, except that presses on draggable items start a drag, not a pan.
      .filter(
        (event: MouseEvent) =>
          (!event.ctrlKey || event.type === 'wheel') &&
          !event.button &&
          (event.type === 'wheel' ||
            !dragEnabledRef.current ||
            dragSourceOf(event.target, treeStore.getState().root) === undefined),
      )
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const t = event.transform;
        transformRef.current = t;
        content.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        // The dot grid moves and scales with the content.
        container.style.backgroundPosition = `${t.x}px ${t.y}px`;
        container.style.backgroundSize = `${GRID_SIZE * t.k}px ${GRID_SIZE * t.k}px`;
      });
    zoomRef.current = behavior;
    const containerSelection = select(container).call(behavior).on('dblclick.zoom', null);
    return () => {
      containerSelection.on('.zoom', null);
      zoomRef.current = undefined;
    };
  }, []);

  // Node sizes are read from the DOM (an external system) after every commit that rendered a new
  // tree, project or layout, so the layout can depend on them. Sizes are only stored when they
  // differ, so this settles. Other commits (e.g. a selection change) skip the measurement, which
  // forces a synchronous reflow of every node; size changes from styling alone are reported by the
  // ResizeObserver. The root is centered once the sizes of the rendered layout are stable
  // (wrapping can still change sizes when the layout moves nodes).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs after every commit
  useLayoutEffect(() => {
    layoutRef.current = layout;
    const measured = measuredRef.current;
    if (measured.root === root && measured.project === project && measured.layout === layout) {
      return;
    }
    measuredRef.current = { root, project, layout };
    const next = controller.measure();
    if (sameSizes(sizes, next)) {
      if (!centeredRef.current && root && layout && sizes.has(root.id)) {
        centeredRef.current = true;
        centerOn(root.id);
      }
      const pending = pendingFocusRef.current;
      if (pending !== undefined && layout?.nodes.has(pending) && sizes.has(pending)) {
        centerOn(pending, FOCUS_MOVE_DURATION);
      }
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement sync
      setSizes(next);
    }
  });

  const measure = useCallback(() => {
    const next = controller.measure();
    setSizes((prev) => (sameSizes(prev, next) ? prev : next));
  }, [controller]);

  useLayoutEffect(() => {
    controller.bind({ onResize: measure, onContextMenu });
  }, [controller, measure, onContextMenu]);

  useLayoutEffect(() => {
    controller.startObserving();
    return () => controller.stopObserving();
  }, [controller]);

  useEffect(
    () =>
      viewportStore.subscribe((state, prev) => {
        if (state.focusSeq !== prev.focusSeq && state.focusNodeId !== undefined) {
          centerOn(state.focusNodeId, FOCUS_MOVE_DURATION);
        }
      }),
    [centerOn],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    controller.beginPress(event.clientX, event.clientY);
    onDragPointerDown(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) {
      controller.endPress();
    } else {
      controller.movePress(event.clientX, event.clientY);
    }
  };
  const onPointerUp = () => {
    controller.endPress();
  };

  const onBackgroundClick = () => {
    if (!controller.isPanned()) {
      treeStore.getState().select(undefined);
      inspectStore.getState().clear();
    }
  };

  const onBackgroundContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!controller.isPanned()) {
      treeStore.getState().select(undefined);
      inspectStore.getState().clear();
      controller.openContextMenu(undefined, event.clientX, event.clientY);
    }
  };

  const selectedFor = (nodeId: string): { selected: boolean; selectedSubId?: string } => {
    if (!selection || selection.nodeId !== nodeId) {
      return { selected: false };
    }
    const sel: Selection = selection;
    return sel.kind === 'node'
      ? { selected: true }
      : { selected: false, selectedSubId: sel.itemId };
  };

  const searchCurrentFor = (nodeId: string): string | undefined =>
    currentMatch && currentMatch.nodeId === nodeId ? selectionKey(currentMatch) : undefined;

  const message = statusMessage(root, treeError, project !== undefined, projectError);
  const showNodes = root !== undefined && project !== undefined && layout !== undefined;

  return (
    <TreeCanvasContext.Provider value={controller}>
      <div
        ref={containerRef}
        className={[
          styles.tree,
          drag ? styles.dragging : '',
          drag?.invalid ? styles.dragInvalid : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
        onContextMenu={onBackgroundContextMenu}
      >
        <div
          ref={contentRef}
          className={styles.content}
          style={{
            width: layout?.width ?? MIN_CANVAS_SIZE,
            height: layout?.height ?? MIN_CANVAS_SIZE,
          }}
        >
          {showNodes && layout && project && (
            <>
              <svg
                className={styles.links}
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                {layout.links.map((link) => (
                  <path
                    key={`${link.parentId}-${link.childId}`}
                    className={styles.link}
                    d={linkPath(link)}
                  />
                ))}
                {layout.linkStarts.map((start) => (
                  <line
                    key={`start-${start.x}-${start.y1}`}
                    className={styles.link}
                    x1={start.x}
                    y1={start.y1}
                    x2={start.x}
                    y2={start.y2}
                  />
                ))}
              </svg>
              {nodes.map((node) => {
                const position = layout.nodes.get(node.id);
                if (!position) {
                  return null;
                }
                const { selected, selectedSubId } = selectedFor(node.id);
                return (
                  <TreeNodeView
                    key={node.id}
                    node={node}
                    project={project}
                    x={position.x}
                    y={position.y}
                    selected={selected}
                    selectedSubId={selectedSubId}
                    runActive={runActive}
                    runStatus={viewed?.statuses[node.id]}
                    subStatuses={viewed?.subStatuses}
                    breakpoint={breakpoints.has(node.id)}
                    exportIds={exportIds}
                    childCount={node.childNodes.length}
                    collapsed={hiddenCounts.has(node.id)}
                    hiddenCount={hiddenCounts.get(node.id)}
                    searchHits={searchHits}
                    searchCurrent={searchCurrentFor(node.id)}
                  />
                );
              })}
            </>
          )}
        </div>
        {message && <div className={styles.status}>{message}</div>}
        {drag?.indicator && (
          <div
            className={drag.indicator.kind === 'box' ? styles.dropBox : styles.dropLine}
            data-drop-indicator={drag.indicator.kind}
            style={{
              left: drag.indicator.rect.left,
              top: drag.indicator.rect.top,
              width: drag.indicator.rect.width,
              height: drag.indicator.rect.height,
            }}
          />
        )}
      </div>
      <TreeSearch matches={searchMatches} />
    </TreeCanvasContext.Provider>
  );
}
