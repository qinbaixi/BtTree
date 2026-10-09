import type {
  IdGen,
  PropertyValueJson,
  SubItem,
  SubItemJson,
  TreeNode,
  TreeNodeJson,
} from './types';

const NODE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'label',
  'comment',
  'decorators',
  'services',
  'childNodes',
]);

const SUB_ITEM_KEYS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'label',
  'comment',
  'periodic',
  'inverseCheckCondition',
  'timeBetweenTicks',
  'firstTickTime',
]);

/** Creates an id generator returning `${prefix}1`, `${prefix}2`, ... */
export function createIdGen(prefix = 'n'): IdGen {
  let counter = 0;
  return () => {
    counter++;
    return `${prefix}${counter}`;
  };
}

function toPropertyRecord(list: PropertyValueJson[] | undefined): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (Array.isArray(list)) {
    for (const prop of list) {
      record[prop.name] = prop.value;
    }
  }
  return record;
}

function toPropertyArray(record: Record<string, unknown>): PropertyValueJson[] {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({ name, value }));
}

/** Copies unknown keys (skipping '$' internal keys) in their original order. */
function pickExtra(json: object, knownKeys: ReadonlySet<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (!knownKeys.has(key) && !key.startsWith('$')) {
      extra[key] = value;
    }
  }
  return extra;
}

function copyExtra(extra: Record<string, unknown>, target: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = cloneValue(inner);
    }
    return out;
  }
  return value;
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(record) as Record<string, unknown>;
}

/** Converts a sub item (decorator/service) JSON to the runtime model. */
export function subItemFromJson(json: SubItemJson, idGen: IdGen): SubItem {
  const item: SubItem = {
    id: idGen(),
    type: json.type || 'unknown',
    properties: toPropertyRecord(json.properties),
    extra: pickExtra(json, SUB_ITEM_KEYS),
  };
  if (json.label != null) item.label = json.label;
  if (json.comment != null) item.comment = json.comment;
  if (json.periodic != null) item.periodic = json.periodic;
  if (json.inverseCheckCondition != null) item.inverseCheckCondition = json.inverseCheckCondition;
  if (json.timeBetweenTicks != null) item.timeBetweenTicks = json.timeBetweenTicks;
  if (json.firstTickTime != null) item.firstTickTime = json.firstTickTime;
  return item;
}

/** Converts a node JSON (recursively, including children) to the runtime model. */
export function nodeFromJson(json: TreeNodeJson, idGen: IdGen): TreeNode {
  const node: TreeNode = {
    id: idGen(),
    type: json.type || 'unknown',
    properties: toPropertyRecord(json.properties),
    decorators: (json.decorators ?? []).map((d) => subItemFromJson(d, idGen)),
    services: (json.services ?? []).map((s) => subItemFromJson(s, idGen)),
    childNodes: (json.childNodes ?? []).map((c) => nodeFromJson(c, idGen)),
    extra: pickExtra(json, NODE_KEYS),
  };
  if (json.label != null) node.label = json.label;
  if (json.comment != null) node.comment = json.comment;
  return node;
}

/** Converts a runtime sub item back to JSON. */
export function subItemToJson(item: SubItem): SubItemJson {
  const out: SubItemJson = { type: item.type };
  copyExtra(item.extra, out);
  if (item.label != null) out.label = item.label;
  if (item.comment != null) out.comment = item.comment;
  if (item.periodic != null) out.periodic = item.periodic;
  if (item.inverseCheckCondition != null) out.inverseCheckCondition = item.inverseCheckCondition;
  if (item.timeBetweenTicks != null) out.timeBetweenTicks = item.timeBetweenTicks;
  if (item.firstTickTime != null) out.firstTickTime = item.firstTickTime;
  const properties = toPropertyArray(item.properties);
  if (properties.length > 0) out.properties = properties;
  return out;
}

/** Converts a runtime node (recursively) back to JSON. */
export function nodeToJson(node: TreeNode): TreeNodeJson {
  const out: TreeNodeJson = { type: node.type };
  copyExtra(node.extra, out);
  if (node.label != null) out.label = node.label;
  if (node.comment != null) out.comment = node.comment;
  const properties = toPropertyArray(node.properties);
  if (properties.length > 0) out.properties = properties;
  if (node.decorators.length > 0) out.decorators = node.decorators.map(subItemToJson);
  if (node.services.length > 0) out.services = node.services.map(subItemToJson);
  if (node.childNodes.length > 0) out.childNodes = node.childNodes.map(nodeToJson);
  return out;
}

/** Deep copy of a sub item with fresh ids. */
export function cloneSubItem(item: SubItem, idGen: IdGen): SubItem {
  return {
    ...item,
    id: idGen(),
    properties: cloneRecord(item.properties),
    extra: cloneRecord(item.extra),
  };
}

/** Deep copy of a node and all its descendants with fresh ids. */
export function cloneNode(node: TreeNode, idGen: IdGen): TreeNode {
  return {
    ...node,
    id: idGen(),
    properties: cloneRecord(node.properties),
    extra: cloneRecord(node.extra),
    decorators: node.decorators.map((d) => cloneSubItem(d, idGen)),
    services: node.services.map((s) => cloneSubItem(s, idGen)),
    childNodes: node.childNodes.map((c) => cloneNode(c, idGen)),
  };
}

/** Serializes a tree to the owl-bt JSON file format (tab indented). */
export function serializeTree(root: TreeNode): string {
  return JSON.stringify(nodeToJson(root), null, '\t');
}
