import { memo, useCallback, useContext, type CSSProperties, type MouseEvent } from 'react';
import {
  describeItem,
  getItemType,
  isItemValid,
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
  /** False renders a static card: no selection and no context menu (project editor preview). */
  interactive?: boolean;
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
}

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
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={style}
      data-item-kind={kind}
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
}: TreeNodeViewProps) {
  const canvas = useContext(TreeCanvasContext);
  // The element is registered for measuring; the controller is stable so this callback is too.
  const registerRef = useCallback(
    (element: HTMLDivElement | null) => canvas.registerNode(node.id, element),
    [canvas, node.id],
  );

  const nodeType = getItemType(project, 'node', node.type);
  const nodeInvalid = !isItemValid(nodeType, node.properties);
  const cardClass = [
    styles.node,
    selected ? styles.nodeSelected : '',
    nodeInvalid ? styles.nodeInvalid : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={registerRef}
      className={cardClass}
      data-node-id={node.id}
      style={
        {
          left: x,
          top: y,
          ...(nodeInvalid ? {} : { '--item-color': nodeType.color }),
        } as CSSProperties
      }
    >
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
        />
      ))}
    </div>
  );
});
