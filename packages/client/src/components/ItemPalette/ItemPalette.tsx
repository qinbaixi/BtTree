import { useMemo, useState, type CSSProperties } from 'react';
import type { CompiledProject, ItemKind } from '@owlbt/shared';
import {
  addItemToNode,
  compareStrings,
  isCompositeNode,
  listNodeChoices,
  type ItemChoice,
} from '../../commands/itemTypes';
import { getJson, setJson } from '../../lib/storage';
import { inspectStore } from '../../store/inspectStore';
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

  // With a selection, groups that cannot be added to the selected node are disabled.
  // Without a selection every type can be inspected.
  const nodeId = selected?.node.id;
  const composite = selected ? isCompositeNode(project, selected.node) : false;
  const nodeHint = !selected
    ? undefined
    : composite
      ? undefined
      : 'Select a composite node to add child nodes';

  return (
    <div className={styles.palette}>
      {!selected && (
        <p className={styles.hint}>
          Click a type to see its definition, or select a node to add items
        </p>
      )}
      <PaletteGroup
        id="composite"
        title="Composite Nodes"
        choices={groups.compositeNodes}
        hasSelection={selected !== undefined}
        addTo={composite ? nodeId : undefined}
        hint={nodeHint}
      />
      <PaletteGroup
        id="action"
        title="Action Nodes"
        choices={groups.actionNodes}
        hasSelection={selected !== undefined}
        addTo={composite ? nodeId : undefined}
        hint={nodeHint}
      />
      <PaletteGroup
        id="services"
        title="Services"
        choices={groups.services}
        hasSelection={selected !== undefined}
        addTo={nodeId}
      />
      <PaletteGroup
        id="decorators"
        title="Decorators"
        choices={groups.decorators}
        hasSelection={selected !== undefined}
        addTo={nodeId}
      />
    </div>
  );
}

interface PaletteGroupProps {
  id: string;
  title: string;
  choices: ItemChoice[];
  /**
   * True when a node is selected. Clicking a type then adds it to `addTo`;
   * without a selection clicking a type shows its definition.
   */
  hasSelection: boolean;
  /** Node the items are added to; undefined disables the items while a node is selected. */
  addTo: string | undefined;
  /** Shown above the items, e.g. why they are disabled. */
  hint?: string;
}

function PaletteGroup({ id, title, choices, hasSelection, addTo, hint }: PaletteGroupProps) {
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
            <PaletteItem
              key={`${choice.itemType}:${choice.type.name}`}
              choice={choice}
              hasSelection={hasSelection}
              addTo={addTo}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface PaletteItemProps {
  choice: ItemChoice;
  hasSelection: boolean;
  addTo: string | undefined;
}

function PaletteItem({ choice, hasSelection, addTo }: PaletteItemProps) {
  const { name, color, icon, description } = choice.type;
  const itemType: ItemKind = choice.itemType;
  const disabled = hasSelection && addTo === undefined;

  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.item}
        style={{ '--item-color': color } as CSSProperties}
        title={description}
        disabled={disabled}
        onClick={() => {
          if (!hasSelection) {
            inspectStore.getState().inspect(itemType, name);
          } else if (addTo !== undefined) {
            addItemToNode(treeStore, addTo, itemType, name);
          }
        }}
      >
        <span className={styles.badge}>
          {icon && <i className={`fa-solid fa-${icon} ${styles.icon}`} aria-hidden="true" />}
        </span>
        <span className={styles.name}>{name}</span>
      </button>
      <button
        type="button"
        className={styles.info}
        style={{ '--item-color': color } as CSSProperties}
        title={`Show details of ${name}`}
        aria-label={`Show details of ${name}`}
        onClick={() => inspectStore.getState().inspect(itemType, name)}
      >
        <i className="fa-solid fa-circle-info" aria-hidden="true" />
      </button>
    </li>
  );
}
