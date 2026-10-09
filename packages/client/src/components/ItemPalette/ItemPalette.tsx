import { useMemo, useState } from 'react';
import type { CompiledProject } from '@owlbt/shared';
import {
  addItemToNode,
  compareStrings,
  isCompositeNode,
  listNodeChoices,
  type ItemChoice,
} from '../../commands/itemTypes';
import { getJson, setJson } from '../../lib/storage';
import { useProjectStore } from '../../store/projectStore';
import { treeStore, useSelectedItem } from '../../store/treeStore';
import styles from './ItemPalette.module.css';

export const PALETTE_GROUP_STORAGE_PREFIX = 'palette-group-';

interface PaletteGroups {
  compositeNodes: ItemChoice[];
  actionNodes: ItemChoice[];
  services: ItemChoice[];
  decorators: ItemChoice[];
}

function sortedByName(choices: ItemChoice[]): ItemChoice[] {
  return choices.sort((a, b) => compareStrings(a.type.name, b.type.name));
}

export function buildPaletteGroups(project: CompiledProject): PaletteGroups {
  const nodes = listNodeChoices(project);
  return {
    compositeNodes: sortedByName(nodes.filter((choice) => choice.type.isComposite)),
    actionNodes: sortedByName(nodes.filter((choice) => !choice.type.isComposite)),
    services: sortedByName(
      Object.values(project.services).map((type) => ({ itemType: 'service' as const, type })),
    ),
    decorators: sortedByName(
      Object.values(project.decorators).map((type) => ({ itemType: 'decorator' as const, type })),
    ),
  };
}

export default function ItemPalette() {
  const project = useProjectStore((state) => state.project);
  const selected = useSelectedItem();
  const groups = useMemo(() => (project ? buildPaletteGroups(project) : undefined), [project]);

  if (!project || !groups) {
    return <p className={styles.hint}>Loading project...</p>;
  }

  // All groups stay visible; groups that cannot be added to the current selection are disabled.
  const nodeId = selected?.node.id;
  const composite = selected ? isCompositeNode(project, selected.node) : false;
  const nodeHint = !selected
    ? undefined
    : composite
      ? undefined
      : 'Select a composite node to add child nodes';

  return (
    <div className={styles.palette}>
      {!selected && <p className={styles.hint}>Select a node in the tree view to add items</p>}
      <PaletteGroup
        id="composite"
        title="Composite Nodes"
        choices={groups.compositeNodes}
        nodeId={composite ? nodeId : undefined}
        hint={nodeHint}
      />
      <PaletteGroup
        id="action"
        title="Action Nodes"
        choices={groups.actionNodes}
        nodeId={composite ? nodeId : undefined}
        hint={nodeHint}
      />
      <PaletteGroup id="services" title="Services" choices={groups.services} nodeId={nodeId} />
      <PaletteGroup
        id="decorators"
        title="Decorators"
        choices={groups.decorators}
        nodeId={nodeId}
      />
    </div>
  );
}

interface PaletteGroupProps {
  id: string;
  title: string;
  choices: ItemChoice[];
  /** Node the items are added to; undefined disables the items. */
  nodeId: string | undefined;
  /** Shown above the items, e.g. why they are disabled. */
  hint?: string;
}

function PaletteGroup({ id, title, choices, nodeId, hint }: PaletteGroupProps) {
  const storageKey = `${PALETTE_GROUP_STORAGE_PREFIX}${id}`;
  const [collapsed, setCollapsed] = useState<boolean>(
    () => getJson<unknown>(storageKey, false) === true,
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setJson(storageKey, next);
  };

  return (
    <div className={styles.group}>
      <button type="button" className={styles.title} aria-expanded={!collapsed} onClick={toggle}>
        {title}
        <i
          className={`fa-solid ${collapsed ? 'fa-angle-down' : 'fa-angle-up'} ${styles.state}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && hint && <p className={styles.groupHint}>{hint}</p>}
      {!collapsed && (
        <ul className={styles.items}>
          {choices.map((choice) => (
            <li key={`${choice.itemType}:${choice.type.name}`}>
              <button
                type="button"
                className={styles.item}
                style={{ borderLeftColor: choice.type.color }}
                title={choice.type.description}
                disabled={nodeId === undefined}
                onClick={() => {
                  if (nodeId !== undefined) {
                    addItemToNode(treeStore, nodeId, choice.itemType, choice.type.name);
                  }
                }}
              >
                {choice.type.icon && (
                  <i
                    className={`fa-solid fa-${choice.type.icon} ${styles.icon}`}
                    aria-hidden="true"
                  />
                )}
                <span>{choice.type.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
