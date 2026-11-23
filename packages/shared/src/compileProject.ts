import { compileBlackboard } from './blackboard';
import type {
  CompiledItemType,
  CompiledProject,
  CompiledProperty,
  CustomTypeJson,
  ItemKind,
  ItemTypeDescJson,
  ProjectFile,
  PropertyDescJson,
  SimulateJson,
} from './types';

export const DEFAULT_COLORS = {
  composite: '#d08038',
  action: '#955cc6',
  service: '#5cc690',
  decorator: '#5c90c6',
} as const;

const BUCKET_BY_KIND = {
  node: 'nodes',
  decorator: 'decorators',
  service: 'services',
} as const satisfies Record<ItemKind, keyof CompiledProject>;

type PropertyType = CompiledProperty['type'];

/** Property that holds the referenced tree of a subtree reference node (see subtree.ts). */
export const SUBTREE_PROPERTY = 'Tree';

/** Declaration added to subtree types that do not declare the property themselves. */
export const SUBTREE_PROPERTY_DESC: CompiledProperty = {
  name: SUBTREE_PROPERTY,
  type: 'string',
  description: 'Tree file to run, relative to the project folder',
};

function isBasePropertyType(type: string): type is PropertyType {
  return type === 'string' || type === 'number' || type === 'bool' || type === 'enum';
}

function defaultColor(kind: ItemKind, isComposite: boolean): string {
  if (kind === 'node') {
    return isComposite ? DEFAULT_COLORS.composite : DEFAULT_COLORS.action;
  }
  return kind === 'decorator' ? DEFAULT_COLORS.decorator : DEFAULT_COLORS.service;
}

function basesOf(desc: ItemTypeDescJson): string[] {
  if (desc.base === undefined || desc.base === '') {
    return [];
  }
  return Array.isArray(desc.base) ? desc.base : [desc.base];
}

/** Shallow-merges properties that share a name, keeping the position of the first occurrence. */
function dedupeProperties(props: PropertyDescJson[]): PropertyDescJson[] {
  const out: PropertyDescJson[] = [];
  const byName = new Map<string, number>();
  for (const prop of props) {
    const index = byName.get(prop.name);
    if (index !== undefined) {
      out[index] = { ...out[index], ...prop };
    } else {
      byName.set(prop.name, out.length);
      out.push(prop);
    }
  }
  return out;
}

/** Topological order where every base precedes its derived types. Throws on cycles. */
function sortByBases(descs: Map<string, ItemTypeDescJson>): string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    const current = state.get(name);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      const cycleStart = stack.indexOf(name);
      throw new Error(`Cyclic inheritance: ${[...stack.slice(cycleStart), name].join(' -> ')}`);
    }
    state.set(name, 'visiting');
    stack.push(name);
    const desc = descs.get(name);
    for (const base of desc ? basesOf(desc) : []) {
      visit(base);
    }
    stack.pop();
    state.set(name, 'done');
    order.push(name);
  };

  for (const name of descs.keys()) {
    visit(name);
  }
  return order;
}

function mergeSimulate(
  base: SimulateJson | undefined,
  own: SimulateJson | undefined,
): SimulateJson | undefined {
  if (!base && !own) {
    return undefined;
  }
  return { ...base, ...own };
}

/**
 * Produces the descriptor with inherited fields and properties merged in.
 * Linearizes unique ancestors (post-order DFS from raw descriptors) so diamond inheritance does
 * not let a shared ancestor overwrite a sibling base's explicit overrides.
 */
function resolveInheritance(
  desc: ItemTypeDescJson,
  descs: Map<string, ItemTypeDescJson>,
): ItemTypeDescJson {
  const bases = basesOf(desc);
  if (bases.length === 0) {
    return desc;
  }

  const chain: ItemTypeDescJson[] = [];
  const visited = new Set<string>();
  const collect = (typeName: string): void => {
    if (visited.has(typeName)) {
      return;
    }
    const current = descs.get(typeName);
    if (!current) {
      throw new Error(`Missing base type '${typeName}' for '${desc.name}'`);
    }
    visited.add(typeName);
    for (const base of basesOf(current)) {
      collect(base);
    }
    chain.push(current);
  };
  for (const base of bases) {
    collect(base);
  }
  chain.push(desc);

  const merged: ItemTypeDescJson = { name: desc.name };
  const props: PropertyDescJson[] = [];
  let simulate: SimulateJson | undefined;
  for (const part of chain) {
    for (const [key, value] of Object.entries(part)) {
      if (key === 'name' || key === 'base' || key === 'isAbstract' || key === 'properties' || key === 'simulate') {
        continue;
      }
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    if (part.properties) {
      props.push(...part.properties);
    }
    simulate = mergeSimulate(simulate, part.simulate);
  }
  if (desc.isAbstract !== undefined) {
    merged.isAbstract = desc.isAbstract;
  }
  if (simulate) {
    merged.simulate = simulate;
  }
  merged.properties = dedupeProperties(props);
  return merged;
}

/** Transitive ancestors of `desc` in breadth-first order (direct bases first, then grandparents). */
function collectAncestors(desc: ItemTypeDescJson, descs: Map<string, ItemTypeDescJson>): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>([desc.name]);
  const queue = [...basesOf(desc)];
  for (let i = 0; i < queue.length; i++) {
    const base = queue[i];
    if (seen.has(base)) {
      continue;
    }
    seen.add(base);
    ancestors.push(base);
    const baseDesc = descs.get(base);
    if (baseDesc) {
      queue.push(...basesOf(baseDesc));
    }
  }
  return ancestors;
}

export function resolveProperty(
  prop: PropertyDescJson,
  customTypes: Record<string, CustomTypeJson>,
): CompiledProperty {
  const out: CompiledProperty = { name: prop.name, type: 'string' };

  if (isBasePropertyType(prop.type)) {
    out.type = prop.type;
  } else if (Object.hasOwn(customTypes, prop.type)) {
    const custom = customTypes[prop.type];
    out.type = custom.type === 'number' ? 'number' : 'string';
    out.customType = prop.type;
    if (custom.pattern !== undefined) {
      out.pattern = custom.pattern;
    }
  } else {
    out.customType = prop.type;
  }

  if (prop.default !== undefined) out.default = prop.default;
  if (prop.values !== undefined) out.values = prop.values;
  if (prop.min !== undefined) out.min = prop.min;
  if (prop.max !== undefined) out.max = prop.max;
  if (prop.description !== undefined) out.description = prop.description;
  if (prop.exportName !== undefined) out.exportName = prop.exportName;
  if (prop.exportTo !== undefined) out.exportTo = prop.exportTo;
  return out;
}

function compileItem(
  kind: ItemKind,
  desc: ItemTypeDescJson,
  customTypes: Record<string, CustomTypeJson>,
  bases: string[],
  ancestors: string[],
): CompiledItemType {
  // Subtree references run another tree: they never have child nodes of their own.
  const subtree = kind === 'node' && desc.subtree === true;
  const isComposite = kind === 'node' && !subtree ? !!desc.isComposite : false;
  const item: CompiledItemType = {
    kind,
    name: desc.name,
    color: desc.color ?? defaultColor(kind, isComposite),
    isComposite,
    properties: (desc.properties ?? []).map((p) => resolveProperty(p, customTypes)),
  };
  if (desc.icon !== undefined) item.icon = desc.icon;
  if (desc.description !== undefined) item.description = desc.description;
  if (desc.export !== undefined) item.export = desc.export;
  if (desc.simulate !== undefined) item.simulate = desc.simulate;
  if (bases.length > 0) item.bases = bases;
  if (ancestors.length > 0) item.ancestors = ancestors;
  if (subtree) {
    item.subtree = true;
    if (!item.properties.some((p) => p.name === SUBTREE_PROPERTY)) {
      item.properties.push({ ...SUBTREE_PROPERTY_DESC });
    }
  }
  return item;
}

function compileKind(
  kind: ItemKind,
  list: ItemTypeDescJson[] | undefined,
  customTypes: Record<string, CustomTypeJson>,
): Record<string, CompiledItemType> {
  const descs = new Map<string, ItemTypeDescJson>();
  for (const desc of list ?? []) {
    descs.set(desc.name, desc);
  }

  for (const [name, desc] of descs) {
    for (const base of basesOf(desc)) {
      if (!descs.has(base)) {
        throw new Error(`Missing base type '${base}' for '${name}'`);
      }
    }
  }

  const resolved = new Map<string, ItemTypeDescJson>();
  for (const name of sortByBases(descs)) {
    const desc = descs.get(name);
    if (desc) {
      resolved.set(name, resolveInheritance(desc, descs));
    }
  }

  // Null prototype: a type named like an Object.prototype member must not hit the prototype.
  const result: Record<string, CompiledItemType> = Object.create(null);
  for (const [name, desc] of resolved) {
    if (desc.isAbstract) {
      continue;
    }
    // Bases come from the descriptor as written: inheritance overwrites `base` in the resolved one.
    const original = descs.get(name);
    result[name] = compileItem(
      kind,
      desc,
      customTypes,
      original ? basesOf(original) : [],
      original ? collectAncestors(original, descs) : [],
    );
  }
  return result;
}

/**
 * Compiles a project file: resolves inheritance, removes abstract types,
 * resolves custom property types and fills in default colors.
 * Throws on missing bases and cyclic inheritance.
 */
export function compileProject(file: ProjectFile): CompiledProject {
  const customTypes = file.types ?? {};
  const compiled: CompiledProject = {
    nodes: compileKind('node', file.nodes, customTypes),
    decorators: compileKind('decorator', file.decorators, customTypes),
    services: compileKind('service', file.services, customTypes),
  };
  const blackboard = compileBlackboard(file);
  if (blackboard) {
    compiled.blackboard = blackboard;
  }
  return compiled;
}

/**
 * Returns the compiled type, or a fallback descriptor (isInvalid: true) for types missing from the project.
 */
export function getItemType(
  project: CompiledProject,
  kind: ItemKind,
  name: string,
): CompiledItemType {
  const bucket = project[BUCKET_BY_KIND[kind]];
  if (Object.hasOwn(bucket, name)) {
    return bucket[name];
  }
  const isComposite = kind === 'node';
  return {
    kind,
    name,
    icon: 'triangle-exclamation',
    color: defaultColor(kind, isComposite),
    isComposite,
    properties: [],
    isInvalid: true,
  };
}

/** Parses JSON text and compiles it. Never throws. */
export function parseAndCompileProject(text: string): {
  project?: CompiledProject;
  error?: string;
} {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Project file must contain a JSON object' };
    }
    return { project: compileProject(parsed as ProjectFile) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
