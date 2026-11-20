import { isBlackboardKeyProperty } from './blackboard';
import { getItemType } from './compileProject';
import type {
  CompiledProject,
  ItemKind,
  PropertyValueJson,
  SubItemJson,
  TreeNodeJson,
} from './types';

/*
 * Project-wide references in tree files (plain JSON as stored on disk): finding the items that use a
 * type or a blackboard key, and rewriting them after a rename. Unknown fields are never touched.
 */

/** What a reference names: a node / decorator / service type, or a blackboard key. */
export type RefKind = ItemKind | 'blackboardKey';

export const REF_KINDS: readonly RefKind[] = ['node', 'decorator', 'service', 'blackboardKey'];

export interface RefRename {
  kind: RefKind;
  from: string;
  to: string;
}

export interface UsageQuery {
  kind: RefKind;
  name: string;
}

export interface TreeUsage {
  /** Child indexes from the root to the node (empty for the root). */
  nodePath: number[];
  /** The node itself, or one of its decorators / services. */
  itemKind: ItemKind;
  /** Index of the decorator / service in its list. */
  itemIndex?: number;
  /** Type of the item. */
  type: string;
  label?: string;
  /** Display names from the root down to the node, joined with ' › '. */
  location: string;
  /** Blackboard key usages: the property that holds the key. */
  property?: string;
  /** Blackboard key usages: the key comes from the property default (no value in the tree). */
  isDefault?: boolean;
}

export const LOCATION_SEPARATOR = ' › ';

export function isRefKind(value: unknown): value is RefKind {
  return typeof value === 'string' && (REF_KINDS as readonly string[]).includes(value);
}

function displayName(item: { label?: unknown; type?: unknown }): string {
  if (typeof item.label === 'string' && item.label !== '') {
    return item.label;
  }
  return typeof item.type === 'string' ? item.type : '?';
}

function subItemsOf(node: TreeNodeJson, kind: 'decorator' | 'service'): SubItemJson[] {
  const list = kind === 'decorator' ? node.decorators : node.services;
  return Array.isArray(list) ? list : [];
}

function childrenOf(node: TreeNodeJson): TreeNodeJson[] {
  return Array.isArray(node.childNodes) ? node.childNodes : [];
}

function propertiesOf(item: { properties?: unknown }): PropertyValueJson[] {
  return Array.isArray(item.properties) ? (item.properties as PropertyValueJson[]) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Visits every node (pre-order) with mutable path and display-name stacks (root first, incl. node). */
function walk(
  root: TreeNodeJson,
  visit: (node: TreeNodeJson, path: readonly number[], names: readonly string[]) => void,
  trackNames: boolean,
): void {
  const path: number[] = [];
  const names: string[] = [];
  const step = (node: TreeNodeJson): void => {
    if (!isObject(node)) {
      return;
    }
    if (trackNames) {
      names.push(displayName(node));
    }
    visit(node, path, names);
    const children = childrenOf(node);
    for (let index = 0; index < children.length; index++) {
      path.push(index);
      step(children[index]);
      path.pop();
    }
    if (trackNames) {
      names.pop();
    }
  };
  step(root);
}

/** Every item of the tree (node, decorator, service) with its kind and position. */
function forEachItem(
  root: TreeNodeJson,
  visit: (
    item: TreeNodeJson | SubItemJson,
    kind: ItemKind,
    path: readonly number[],
    names: readonly string[],
    itemIndex?: number,
  ) => void,
  trackNames = true,
): void {
  walk(
    root,
    (node, path, names) => {
      visit(node, 'node', path, names);
      for (const kind of ['decorator', 'service'] as const) {
        const subs = subItemsOf(node, kind);
        for (let index = 0; index < subs.length; index++) {
          const sub = subs[index];
          if (isObject(sub)) {
            visit(sub, kind, path, names, index);
          }
        }
      }
    },
    trackNames,
  );
}

/**
 * Items of a tree that use a type, or that name a blackboard key in a `blackboardKey` property (an
 * explicit value, or the property default when the tree sets none). Blackboard keys need the
 * compiled project to know the property types.
 */
export function findTreeUsages(
  root: TreeNodeJson,
  query: UsageQuery,
  project?: CompiledProject,
): TreeUsage[] {
  const usages: TreeUsage[] = [];
  const keyPropsCache = new Map<string, ReturnType<typeof getItemType>['properties']>();
  const getKeyProps = (kind: ItemKind, type: string) => {
    const cacheKey = `${kind}:${type}`;
    let props = keyPropsCache.get(cacheKey);
    if (!props) {
      props = getItemType(project!, kind, type).properties.filter(isBlackboardKeyProperty);
      keyPropsCache.set(cacheKey, props);
    }
    return props;
  };

  forEachItem(root, (item, kind, path, names, itemIndex) => {
    const type = typeof item.type === 'string' ? item.type : '';
    const makeBase = (): TreeUsage => {
      const base: TreeUsage = {
        nodePath: [...path],
        itemKind: kind,
        type,
        location: names.join(LOCATION_SEPARATOR),
      };
      if (itemIndex !== undefined) {
        base.itemIndex = itemIndex;
      }
      if (typeof item.label === 'string') {
        base.label = item.label;
      }
      return base;
    };

    if (query.kind !== 'blackboardKey') {
      if (query.kind === kind && type === query.name) {
        usages.push(makeBase());
      }
      return;
    }
    if (!project) {
      return;
    }
    const keyProps = getKeyProps(kind, type);
    if (keyProps.length === 0) {
      return;
    }
    const values = propertiesOf(item);
    let base: TreeUsage | undefined;
    for (const prop of keyProps) {
      const explicit = values.find((entry) => isObject(entry) && entry.name === prop.name);
      const hasValue =
        explicit !== undefined && explicit.value !== undefined && explicit.value !== null;
      const value = hasValue ? explicit.value : prop.default;
      if (value === query.name) {
        base ??= makeBase();
        usages.push({ ...base, property: prop.name, ...(hasValue ? {} : { isDefault: true }) });
      }
    }
  });
  return usages;
}

/**
 * Collapses a log of renames (in the order they happened) into the net renames: chains become one
 * rename (a→b, b→c gives a→c) and renames that were reverted disappear (a→b, b→a).
 */
export function collapseRenames(log: readonly RefRename[]): RefRename[] {
  const net: RefRename[] = [];
  for (const rename of log) {
    if (rename.from === rename.to) {
      continue;
    }
    let matched = false;
    for (let i = net.length - 1; i >= 0; i--) {
      const entry = net[i];
      if (entry.kind === rename.kind && entry.to === rename.from) {
        entry.to = rename.to;
        matched = true;
        if (entry.from === entry.to) {
          net.splice(i, 1);
        }
      }
    }
    if (!matched) {
      net.push({ ...rename });
    }
  }
  return net;
}

/**
 * Rewrites the references of a tree (in place) for the given renames. Type renames change the
 * `type` of the nodes / decorators / services of that kind; blackboard key renames change explicit
 * values of `blackboardKey` properties (property types are looked up in `project`, which must
 * already use the new type names). All renames apply at once, so swaps work. Returns the number of
 * changed fields.
 */
export function rewriteTreeReferences(
  root: TreeNodeJson,
  renames: readonly RefRename[],
  project?: CompiledProject,
): number {
  const maps: Record<RefKind, Map<string, string>> = {
    node: new Map(),
    decorator: new Map(),
    service: new Map(),
    blackboardKey: new Map(),
  };
  for (const rename of renames) {
    if (rename.from !== rename.to) {
      maps[rename.kind].set(rename.from, rename.to);
    }
  }
  const keys = maps.blackboardKey;
  const keyPropNamesCache = new Map<string, Set<string>>();
  const getKeyPropNames = (kind: ItemKind, type: string): Set<string> => {
    const cacheKey = `${kind}:${type}`;
    let names = keyPropNamesCache.get(cacheKey);
    if (!names) {
      names = new Set(
        getItemType(project!, kind, type)
          .properties.filter(isBlackboardKeyProperty)
          .map((p) => p.name),
      );
      keyPropNamesCache.set(cacheKey, names);
    }
    return names;
  };
  let changed = 0;

  forEachItem(
    root,
    (item, kind) => {
      if (typeof item.type !== 'string') {
        return;
      }
      const renamed = maps[kind].get(item.type);
      if (renamed !== undefined) {
        item.type = renamed;
        changed++;
      }
      if (keys.size === 0 || !project) {
        return;
      }
      const keyPropNames = getKeyPropNames(kind, item.type);
      if (keyPropNames.size === 0) {
        return;
      }
      for (const entry of propertiesOf(item)) {
        if (isObject(entry) && keyPropNames.has(entry.name) && typeof entry.value === 'string') {
          const key = keys.get(entry.value);
          if (key !== undefined) {
            entry.value = key;
            changed++;
          }
        }
      }
    },
    false,
  );
  return changed;
}
