import { memo, useCallback, useContext, type CSSProperties, type MouseEvent } from 'react';
import {
  describeItem,
  getItemType,
  validateItem,
  type CompiledItemType,
  type CompiledProject,
  type Selection,
  type SubItem,
  type TreeNode,
} from '@owlbt/shared';
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
}

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
}: ItemViewProps) {
  const canvas = useContext(TreeCanvasContext);
  const invalid = !validateItem(type, properties).isValid;
  const defaultName = `${inverseCheckCondition ? '[not] ' : ''}${type.name}`;
  const description = type.description ? describeItem(type, properties) : undefined;

  // Invalid items are painted red by the stylesheet; valid ones use the descriptor color.
  let contentStyle: CSSProperties = {};
  if (!invalid) {
    contentStyle = kind === 'node'
      ? { background: type.color, borderLeftColor: type.color }
      : { borderLeftColor: type.color };
  }

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (!canvas.isPanned()) {
      treeStore.getState().select(selectionOf(kind, nodeId, itemId));
    }
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canvas.isPanned()) {
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
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      data-item-kind={kind}
      data-item-invalid={invalid ? 'true' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {type.icon !== undefined && (
        <span className={styles.icon}>
          <i className={`fa-solid fa-${type.icon}`} aria-hidden="true" />
        </span>
      )}
      <div
        className={`${styles.content} ${comment ? styles.contentWithComment : ''}`}
        style={contentStyle}
      >
        <div className={styles.name}>
          {label ? (
            <>
              <span className={styles.nameSub}>({defaultName})</span>
              <span>{label}</span>
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
}: TreeNodeViewProps) {
  const canvas = useContext(TreeCanvasContext);
  // The element is registered for measuring; the controller is stable so this callback is too.
  const registerRef = useCallback(
    (element: HTMLDivElement | null) => canvas.registerNode(node.id, element),
    [canvas, node.id],
  );

  const nodeType = getItemType(project, 'node', node.type);

  return (
    <div
      ref={registerRef}
      className={styles.node}
      data-node-id={node.id}
      style={{ left: x, top: y }}
    >
      <ItemView
        kind="node"
        nodeId={node.id}
        type={nodeType}
        label={node.label}
        comment={node.comment}
        properties={node.properties}
        selected={selected}
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
        />
      ))}
    </div>
  );
});
