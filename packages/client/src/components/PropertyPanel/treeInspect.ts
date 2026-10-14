import {
  getItemType,
  isItemValid,
  validateItem,
  type CompiledItemType,
  type CompiledProject,
  type Selection,
  type ItemKind,
  type SubtreeProblem,
  type SubItem,
  type TreeNode,
} from '@owlbt/shared';

/** Separator between names in a location path, e.g. 'Root › Pause'. */
export const PATH_SEPARATOR = ' › ';

/** Shown as the location of items that sit directly under the root. */
export const TOP_LEVEL_LABEL = 'Top level';

/** Compiled types of one kind (nodes, decorators or services). */
export function typesOfKind(
  project: CompiledProject,
  kind: ItemKind,
): Record<string, CompiledItemType> {
  if (kind === 'node') {
    return project.nodes;
  }
  return kind === 'decorator' ? project.decorators : project.services;
}

/** Display name of a node or sub item in the tree: its label, or its type. */
export function itemName(item: { label?: string; type: string }): string {
  return item.label ?? item.type;
}

function formatPath(names: readonly string[]): string {
  return names.length > 0 ? names.join(PATH_SEPARATOR) : TOP_LEVEL_LABEL;
}

/**
 * Visits every node with the display names of its ancestors (root first, not including the node).
 * Pre-order, like forEachNode. `ancestors` is one shared stack: read it during the visit, do not keep it.
 */
function walk(root: TreeNode, visit: (node: TreeNode, ancestors: readonly string[]) => void): void {
  const ancestors: string[] = [];
  const step = (node: TreeNode): void => {
    visit(node, ancestors);
    if (node.childNodes.length === 0) {
      return;
    }
    ancestors.push(itemName(node));
    for (const child of node.childNodes) {
      step(child);
    }
    ancestors.pop();
  };
  step(root);
}

export interface TypeUsage {
  /** Node for node types; the owning node for decorators and services. */
  nodeId: string;
  /** Set for decorators and services. */
  itemId?: string;
  label: string;
  /** Location of the item, e.g. 'Root › Pause'. */
  path: string;
}

/** Every node (or decorator/service) of the tree that uses the type, in tree order. */
export function findTypeUsages(
  root: TreeNode | undefined,
  kind: ItemKind,
  name: string,
): TypeUsage[] {
  const usages: TypeUsage[] = [];
  if (!root) {
    return usages;
  }
  walk(root, (node, ancestors) => {
    if (kind === 'node') {
      if (node.type === name) {
        usages.push({ nodeId: node.id, label: itemName(node), path: formatPath(ancestors) });
      }
      return;
    }
    const subItems: SubItem[] = kind === 'decorator' ? node.decorators : node.services;
    for (const item of subItems) {
      if (item.type === name) {
        usages.push({
          nodeId: node.id,
          itemId: item.id,
          label: itemName(item),
          path: formatPath([...ancestors, itemName(node)]),
        });
      }
    }
  });
  return usages;
}

export interface TreeProblem {
  kind: ItemKind;
  nodeId: string;
  itemId?: string;
  /** Type name of the item. */
  type: string;
  /** Location of the item, e.g. 'Root › Missing'. */
  path: string;
  message: string;
}

export interface UsedType {
  name: string;
  count: number;
  /** True when the type is missing from the project file. */
  missing: boolean;
}

export interface TreeSummary {
  nodes: number;
  /** Composite nodes whose type is in the project (missing types are only counted as problems). */
  composite: number;
  /** Non-composite nodes whose type is in the project. */
  actions: number;
  decorators: number;
  services: number;
  /** Number of levels, the root alone counts as 1. */
  maxDepth: number;
  problems: TreeProblem[];
  /** Types used in the tree per kind, sorted by name. */
  usedTypes: Record<ItemKind, UsedType[]>;
}

/**
 * Counts, problems and used types of a tree. `subtreeProblems` (by node id) adds the problems of
 * subtree references: missing files, references outside the project and cycles.
 */
export function summarizeTree(
  root: TreeNode,
  project: CompiledProject,
  subtreeProblems?: ReadonlyMap<string, SubtreeProblem>,
): TreeSummary {
  const summary: TreeSummary = {
    nodes: 0,
    composite: 0,
    actions: 0,
    decorators: 0,
    services: 0,
    maxDepth: 0,
    problems: [],
    usedTypes: { node: [], decorator: [], service: [] },
  };
  const used: Record<ItemKind, Map<string, UsedType>> = {
    node: new Map(),
    decorator: new Map(),
    service: new Map(),
  };
  const countType = (kind: ItemKind, name: string, missing: boolean | undefined) => {
    const entry = used[kind].get(name) ?? { name, count: 0, missing: missing === true };
    entry.count += 1;
    used[kind].set(name, entry);
  };
  const addProblem = (
    kind: ItemKind,
    node: TreeNode,
    ancestors: readonly string[],
    item: { type: string; properties: Record<string, unknown>; id: string },
    itemId?: string,
  ) => {
    const type = getItemType(project, kind, item.type);
    if (isItemValid(type, item.properties)) {
      return;
    }
    const validation = validateItem(type, item.properties);
    const message = validation.missingType
      ? `Missing type '${item.type}'`
      : `Invalid: ${validation.invalidProperties.join(', ')}`;
    summary.problems.push({
      kind,
      nodeId: node.id,
      itemId,
      type: item.type,
      path: formatPath([...ancestors, itemName(node)]),
      message,
    });
  };

  walk(root, (node, ancestors) => {
    summary.nodes += 1;
    summary.maxDepth = Math.max(summary.maxDepth, ancestors.length + 1);

    const type = getItemType(project, 'node', node.type);
    if (!type.isInvalid) {
      if (type.isComposite) {
        summary.composite += 1;
      } else {
        summary.actions += 1;
      }
    }
    countType('node', node.type, type.isInvalid);
    addProblem('node', node, ancestors, node);
    const subtreeProblem = subtreeProblems?.get(node.id);
    if (subtreeProblem) {
      summary.problems.push({
        kind: 'node',
        nodeId: node.id,
        type: node.type,
        path: formatPath([...ancestors, itemName(node)]),
        message: subtreeProblem.message,
      });
    }

    for (const decorator of node.decorators) {
      summary.decorators += 1;
      countType(
        'decorator',
        decorator.type,
        getItemType(project, 'decorator', decorator.type).isInvalid,
      );
      addProblem('decorator', node, ancestors, decorator, decorator.id);
    }
    for (const service of node.services) {
      summary.services += 1;
      countType('service', service.type, getItemType(project, 'service', service.type).isInvalid);
      addProblem('service', node, ancestors, service, service.id);
    }
  });

  for (const kind of ['node', 'decorator', 'service'] as const) {
    summary.usedTypes[kind] = [...used[kind].values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }
  return summary;
}

/** Selection of a node (kind 'node') or of its decorator/service item. Undefined when the item id is missing. */
export function selectionFor(
  kind: ItemKind,
  nodeId: string,
  itemId?: string,
): Selection | undefined {
  if (kind === 'node') {
    return { kind: 'node', nodeId };
  }
  if (itemId === undefined) {
    return undefined;
  }
  return { kind, nodeId, itemId };
}
