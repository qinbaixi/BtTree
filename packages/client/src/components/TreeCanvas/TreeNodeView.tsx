import { memo, useCallback, useContext, type CSSProperties, type MouseEvent } from 'react';
import {
  describeItem,
  getItemType,
  isItemValid,
  type CompiledItemType,
  type CompiledProject,
  type RunStatus,
  type Selection,
  type SubStatus,
  type SubItem,
  type TreeNode,
} from '@owlbt/shared';
import { collapseStore } from '../../store/collapseStore';
import { runStore } from '../../store/runStore';
import { treeStore } from '../../store/treeStore';
import { TreeCanvasContext } from './canvasController';
import styles from './TreeNodeView.module.css';

export interface TreeNodeViewProps {
  node: TreeNode;
  project: CompiledProject;
  /** Canvas position of the node's left/top edge. */
  x: number;
  y: number;
  /** The node header is selected. */
  selected: boolean;
  /** Id of the selected decorator or service of this node, if any. */
  selectedSubId?: string;
  /** False renders a static card: no selection and no context menu (project editor preview). */
  interactive?: boolean;
  /** Run mode: the run panels are shown, so the breakpoint toggle is visible. */
  runActive?: boolean;
  /** Run mode: status of the node in the viewed tick. */
  runStatus?: RunStatus;
  /** Run mode: statuses of decorators / services in the viewed tick (by item id). */
  subStatuses?: Record<string, SubStatus>;
  /** Run mode: a breakpoint is set on the node. */
  breakpoint?: boolean;
  /** Run mode: export number (#N) by node / decorator / service id; set to show the id badges. */
  exportIds?: ReadonlyMap<string, number>;
  /** Number of direct children; a collapse toggle is shown when > 0 (interactive cards only). */
  childCount?: number;
  /** The subtree is collapsed: descendants are hidden and `hiddenCount` is shown as "+N". */
  collapsed?: boolean;
  /** Number of hidden descendants of a collapsed node. */
  hiddenCount?: number;
  /** Search: keys (node or sub item ids) of all matching items of the tree. */
  searchHits?: ReadonlySet<string>;
  /** Search: key of the current result when it belongs to this node. */
  searchCurrent?: string;
}

interface ItemViewProps {
  kind: 'node' | 'decorator' | 'service';
  nodeId: string;
  itemId?: string;
  type: CompiledItemType;
  label?: string;
  comment?: string;
  properties: Record<string, unknown>;
  inverseCheckCondition?: boolean;
  selected: boolean;
  interactive: boolean;
  subStatus?: SubStatus;
  /** Export number shown as a tiny badge (run mode). */
  exportId?: number;
  /** Search: the item matches / is the current result (sub items only; nodes mark the card). */
  searchHit?: boolean;
  searchCurrent?: boolean;
}

const SUB_STATUS_ICON: Record<SubStatus, { icon: string; label: string }> = {
  pass: { icon: 'fa-check', label: 'Passed' },
  fail: { icon: 'fa-xmark', label: 'Failed' },
  ran: { icon: 'fa-bolt', label: 'Ran in this tick' },
};

const KIND_TAG: Record<ItemViewProps['kind'], string | undefined> = {
  node: undefined,
  decorator: 'DEC',
  service: 'SVC',
};

function selectionOf(kind: ItemViewProps['kind'], nodeId: string, itemId?: string): Selection {
  if (kind === 'node' || itemId === undefined) {
    return { kind: 'node', nodeId };
  }
  return { kind, nodeId, itemId };
}

/** Renders the item's properties as a list in the original tree view's order and wording. */
function ItemView({
  kind,
  nodeId,
  itemId,
  type,
  label,
  comment,
  properties,
  inverseCheckCondition,
  selected,
  interactive,
  subStatus,
  exportId,
  searchHit = false,
  searchCurrent = false,
}: ItemViewProps) {
  const canvas = useContext(TreeCanvasContext);
  const invalid = !isItemValid(type, properties);
  const defaultName = `${inverseCheckCondition ? '[not] ' : ''}${type.name}`;
  const description = type.description ? describeItem(type, properties) : undefined;
  // Invalid items are painted red by the stylesheet; valid ones take the type color from the variable.
  const style = invalid ? undefined : ({ '--item-color': type.color } as CSSProperties);
  const iconName = invalid ? 'triangle-exclamation' : type.icon;
  const tag = KIND_TAG[kind];

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (interactive && !canvas.isPanned()) {
      treeStore.getState().select(selectionOf(kind, nodeId, itemId));
    }
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (interactive && !canvas.isPanned()) {
      const sel = selectionOf(kind, nodeId, itemId);
      treeStore.getState().select(sel);
      canvas.openContextMenu(sel, event.clientX, event.clientY);
    }
  };

  const className = [
    styles.item,
    kind === 'node' ? styles.nodeDesc : styles[kind],
    invalid ? styles.invalid : '',
    selected ? styles.selected : '',
    searchHit ? styles.searchHit : '',
    searchCurrent ? styles.searchCurrent : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={style}
      data-item-kind={kind}
      data-item-id={itemId}
      data-search-hit={searchHit ? (searchCurrent ? 'current' : 'true') : undefined}
      data-item-invalid={invalid ? 'true' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {tag && <span className={styles.kindTag}>{tag}</span>}
      {iconName !== undefined && (
        <span className={styles.badge}>
          <i className={`fa-solid fa-${iconName}`} aria-hidden="true" />
        </span>
      )}
      <div className={`${styles.content} ${comment ? styles.contentWithComment : ''}`}>
        <div className={styles.name}>
          {label ? (
            <>
              <span className={styles.nameSub}>({defaultName})</span>
              <span className={styles.label}>{label}</span>
            </>
          ) : (
            defaultName
          )}
        </div>
        {comment && (
          <>
            <span className={styles.commentIcon}>
              <i className="fa-solid fa-circle-info" aria-hidden="true" />
            </span>
            <div className={styles.commentContent}>{comment}</div>
          </>
        )}
        {type.description && <div className={styles.desc}>{description ?? ''}</div>}
      </div>
      {exportId !== undefined && kind !== 'node' && (
        <span className={styles.itemExportId} data-export-id={exportId}>
          #{exportId}
        </span>
      )}
      {subStatus && (
        <span
          className={`${styles.subStatus} ${styles[`sub_${subStatus}`]}`}
          title={SUB_STATUS_ICON[subStatus].label}
          data-sub-status={subStatus}
        >
          <i className={`fa-solid ${SUB_STATUS_ICON[subStatus].icon}`} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

export const TreeNodeView = memo(function TreeNodeView({
  node,
  project,
  x,
  y,
  selected,
  selectedSubId,
  interactive = true,
  runActive = false,
  runStatus,
  subStatuses,
  breakpoint = false,
  exportIds,
  childCount = 0,
  collapsed = false,
  hiddenCount = 0,
  searchHits,
  searchCurrent,
}: TreeNodeViewProps) {
  const canvas = useContext(TreeCanvasContext);
  // The element is registered for measuring; the controller is stable so this callback is too.
  const registerRef = useCallback(
    (element: HTMLDivElement | null) => canvas.registerNode(node.id, element),
    [canvas, node.id],
  );

  const nodeType = getItemType(project, 'node', node.type);
  const ids = runActive ? exportIds : undefined;
  const nodeExportId = ids?.get(node.id);
  const nodeInvalid = !isItemValid(nodeType, node.properties);
  const nodeHit = searchHits?.has(node.id) ?? false;
  const nodeCurrent = searchCurrent === node.id;
  const cardClass = [
    styles.node,
    selected ? styles.nodeSelected : '',
    nodeHit ? styles.nodeSearchHit : '',
    nodeCurrent ? styles.nodeSearchCurrent : '',
    nodeInvalid ? styles.nodeInvalid : '',
    runActive ? styles[`run_${runStatus ?? 'idle'}`] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={registerRef}
      className={cardClass}
      data-node-id={node.id}
      data-run-status={runActive ? (runStatus ?? 'idle') : undefined}
      data-collapsed={collapsed ? 'true' : undefined}
      data-search-hit={nodeHit ? (nodeCurrent ? 'current' : 'true') : undefined}
      style={
        {
          left: x,
          top: y,
          ...(nodeInvalid ? {} : { '--item-color': nodeType.color }),
        } as CSSProperties
      }
    >
      {runActive && (
        <button
          type="button"
          className={`${styles.breakpoint} ${breakpoint ? styles.breakpointOn : ''}`}
          title={breakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
          aria-label="Toggle breakpoint"
          aria-pressed={breakpoint}
          data-breakpoint={breakpoint ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            runStore.getState().toggleBreakpoint(node.id);
          }}
          onContextMenu={(event) => event.stopPropagation()}
        />
      )}
      {nodeExportId !== undefined && (
        <span className={styles.exportId} data-export-id={nodeExportId} title="Export node id">
          #{nodeExportId}
        </span>
      )}
      {runActive && (runStatus === 'success' || runStatus === 'failure') && (
        <span className={`${styles.runBadge} ${styles[`badge_${runStatus}`]}`} aria-hidden="true">
          <i className={`fa-solid ${runStatus === 'success' ? 'fa-check' : 'fa-xmark'}`} />
        </span>
      )}
      <ItemView
        kind="node"
        nodeId={node.id}
        type={nodeType}
        label={node.label}
        comment={node.comment}
        properties={node.properties}
        selected={selected}
        interactive={interactive}
      />
      {node.decorators.map((decorator: SubItem) => (
        <ItemView
          key={decorator.id}
          kind="decorator"
          nodeId={node.id}
          itemId={decorator.id}
          type={getItemType(project, 'decorator', decorator.type)}
          label={decorator.label}
          comment={decorator.comment}
          properties={decorator.properties}
          inverseCheckCondition={decorator.inverseCheckCondition}
          selected={selectedSubId === decorator.id}
          interactive={interactive}
          subStatus={runActive ? subStatuses?.[decorator.id] : undefined}
          exportId={ids?.get(decorator.id)}
          searchHit={searchHits?.has(decorator.id)}
          searchCurrent={searchCurrent === decorator.id}
        />
      ))}
      {node.services.map((service: SubItem) => (
        <ItemView
          key={service.id}
          kind="service"
          nodeId={node.id}
          itemId={service.id}
          type={getItemType(project, 'service', service.type)}
          label={service.label}
          comment={service.comment}
          properties={service.properties}
          inverseCheckCondition={service.inverseCheckCondition}
          selected={selectedSubId === service.id}
          interactive={interactive}
          subStatus={runActive ? subStatuses?.[service.id] : undefined}
          exportId={ids?.get(service.id)}
          searchHit={searchHits?.has(service.id)}
          searchCurrent={searchCurrent === service.id}
        />
      ))}
      {interactive && childCount > 0 && (
        <button
          type="button"
          className={`${styles.collapseToggle} ${collapsed ? styles.collapsedBadge : ''}`}
          title={collapsed ? 'Expand subtree' : 'Collapse subtree'}
          aria-label={collapsed ? 'Expand subtree' : 'Collapse subtree'}
          aria-expanded={!collapsed}
          data-collapse-toggle={collapsed ? 'collapsed' : 'expanded'}
          onClick={(event) => {
            event.stopPropagation();
            if (!canvas.isPanned()) {
              collapseStore.getState().toggle(node.id);
            }
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {collapsed ? `+${hiddenCount}` : <i className="fa-solid fa-minus" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
});
