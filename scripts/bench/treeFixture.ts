import {
  validatePropertyValue,
  type CompiledItemType,
  type CompiledProject,
  type CompiledProperty,
  type PropertyValueJson,
  type SubItemJson,
  type TreeNodeJson,
} from '@owlbt/shared';

/* Generated benchmark trees. No Node APIs here, so the client's canvas benchmark can use it too. */

/** Deterministic pseudo random numbers (mulberry32), so every run builds the same trees. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CANDIDATES: unknown[] = ['target_key', 0.5, 1, 'text'];

function validValue(prop: CompiledProperty): unknown {
  switch (prop.type) {
    case 'enum':
      return prop.values?.[0];
    case 'bool':
      return true;
    default:
      return CANDIDATES.find((value) => validatePropertyValue(prop, value));
  }
}

function propertiesOf(type: CompiledItemType): PropertyValueJson[] {
  return type.properties.map((prop) => ({ name: prop.name, value: validValue(prop) }));
}

/**
 * A valid tree of `size` nodes: composites up to `maxDepth` levels, leaves at the bottom, and
 * one or two decorators/services on most nodes. Every property has an explicit valid value.
 */
export function buildTreeJson(
  project: CompiledProject,
  size: number,
  seed = 1,
  maxDepth = 10,
): TreeNodeJson {
  const random = createRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const composites = Object.values(project.nodes).filter((type) => type.isComposite);
  const leaves = Object.values(project.nodes).filter((type) => !type.isComposite);
  const decorators = Object.values(project.decorators);
  const services = Object.values(project.services);

  const subItems = (types: CompiledItemType[], count: number): SubItemJson[] =>
    Array.from({ length: count }, () => {
      const type = pick(types);
      return { type: type.name, properties: propertiesOf(type) };
    });

  let remaining = size;
  const make = (level: number): TreeNodeJson => {
    remaining--;
    const composite = level < 3 || (level < maxDepth - 1 && random() < 0.45);
    const type = composite ? pick(composites) : pick(leaves);
    const json: TreeNodeJson = {
      type: type.name,
      label: `${type.name} ${size - remaining}`,
      properties: propertiesOf(type),
      decorators: subItems(decorators, Math.floor(random() * 3)),
      services: subItems(services, Math.floor(random() * 2)),
    };
    if (composite) {
      const children: TreeNodeJson[] = [];
      const count = 1 + Math.floor(random() * 5);
      for (let i = 0; i < count && remaining > 0; i++) {
        children.push(make(level + 1));
      }
      json.childNodes = children;
    }
    return json;
  };

  // Subtrees are bounded by `maxDepth`, so the root gets new ones until the size is used up.
  const root: TreeNodeJson = { type: composites[0].name, childNodes: [] };
  remaining--;
  while (remaining > 0) {
    root.childNodes!.push(make(1));
  }
  return root;
}
