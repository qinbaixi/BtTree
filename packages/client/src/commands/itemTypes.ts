import {
  addChildNode,
  addSubItem,
  findNode,
  getItemType,
  nodeFromJson,
  subItemFromJson,
  type CompiledItemType,
  type CompiledProject,
  type ItemKind,
  type SubItemKind,
  type TreeNode,
} from '@owlbt/shared';
import type { TreeStore } from '../store/treeStore';

/** A compiled type that can be added to a tree, with its item kind. */
export interface ItemChoice {
  itemType: ItemKind;
  type: CompiledItemType;
}

const CHOICE_PREFIX: Record<ItemKind, string> = {
  node: 'node:',
  decorator: 'dec:',
  service: 'svc:',
};

/** Id (and display name) used by the Add and Set Node Type dialogs, e.g. 'node:Wait'. */
export function choiceId(itemType: ItemKind, typeName: string): string {
  return `${CHOICE_PREFIX[itemType]}${typeName}`;
}

export function isCompositeNode(project: CompiledProject | undefined, node: TreeNode): boolean {
  return project !== undefined && getItemType(project, 'node', node.type).isComposite;
}

function subItemChoices(project: CompiledProject): ItemChoice[] {
  return [
    ...Object.values(project.services).map((type) => ({ itemType: 'service' as const, type })),
    ...Object.values(project.decorators).map((type) => ({ itemType: 'decorator' as const, type })),
  ];
}

export function listNodeChoices(project: CompiledProject): ItemChoice[] {
  return Object.values(project.nodes).map((type) => ({ itemType: 'node' as const, type }));
}

/**
 * Types that can be added to the target node: nodes only for composite targets,
 * decorators and services always. Sorted by their dialog id.
 */
export function listAddableChoices(project: CompiledProject, target: TreeNode): ItemChoice[] {
  const choices = isCompositeNode(project, target)
    ? [...listNodeChoices(project), ...subItemChoices(project)]
    : subItemChoices(project);
  return choices.sort((a, b) => compareStrings(choiceId(a.itemType, a.type.name), choiceId(b.itemType, b.type.name)));
}

export function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Appends a new item of the given type (with empty properties) to the end of a node's
 * children, decorators or services. The selection is not changed.
 */
export function addItemToNode(
  tree: TreeStore,
  nodeId: string,
  itemType: ItemKind,
  typeName: string,
): boolean {
  const state = tree.getState();
  const idGen = state.getIdGen();
  const label = `Add ${typeName}`;

  if (itemType === 'node') {
    const created = nodeFromJson({ type: typeName }, idGen);
    return state.apply(label, (draft) => {
      const node = findNode(draft, nodeId);
      if (node) {
        addChildNode(node, created);
      }
    });
  }

  const created = subItemFromJson({ type: typeName }, idGen);
  const kind: SubItemKind = itemType;
  return state.apply(label, (draft) => {
    const node = findNode(draft, nodeId);
    if (node) {
      addSubItem(node, kind, created);
    }
  });
}
