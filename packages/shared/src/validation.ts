import { getItemType } from './compileProject';
import { forEachNode } from './treeOps';
import type {
  CompiledItemType,
  CompiledProject,
  CompiledProperty,
  ItemValidation,
  TreeNode,
} from './types';

export interface MissingTypes {
  nodes: string[];
  decorators: string[];
  services: string[];
}

/** Compiled custom type patterns (null for invalid ones). Patterns come from a handful of custom types. */
const PATTERN_CACHE = new Map<string, RegExp | null>();
const PATTERN_CACHE_LIMIT = 1000;

/** Anchored regex for a custom type pattern, compiled once; null when the pattern is invalid. */
function patternRegex(pattern: string): RegExp | null {
  let regex = PATTERN_CACHE.get(pattern);
  if (regex === undefined) {
    try {
      regex = new RegExp(`^(?:${pattern})$`);
    } catch {
      regex = null;
    }
    if (PATTERN_CACHE.size >= PATTERN_CACHE_LIMIT) {
      // Patterns typed in the project editor create new entries; start over instead of growing.
      PATTERN_CACHE.clear();
    }
    PATTERN_CACHE.set(pattern, regex);
  }
  return regex;
}

/**
 * Validates a value against a compiled property.
 * null, undefined and '' are always valid. A pattern (from a custom type) takes precedence over the type checks.
 */
export function validatePropertyValue(prop: CompiledProperty, value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (prop.pattern) {
    const regex = patternRegex(prop.pattern);
    return regex !== null && regex.test(String(value));
  }

  switch (prop.type) {
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (prop.min === undefined || value >= prop.min) &&
        (prop.max === undefined || value <= prop.max)
      );
    case 'enum':
      return typeof value === 'string' && (prop.values ?? []).includes(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return true;
  }
}

/** Explicit value when set (not undefined), otherwise the declared default. */
export function getEffectiveValue(
  prop: CompiledProperty,
  properties: Record<string, unknown>,
): unknown {
  const value = Object.hasOwn(properties, prop.name) ? properties[prop.name] : undefined;
  return value !== undefined ? value : prop.default;
}

/** Validates an item's properties against its compiled type. A missing type is never valid. */
export function validateItem(
  type: CompiledItemType,
  properties: Record<string, unknown>,
): ItemValidation {
  const invalidProperties = type.properties
    .filter((prop) => !validatePropertyValue(prop, getEffectiveValue(prop, properties)))
    .map((prop) => prop.name);
  const missingType = type.isInvalid === true;
  return {
    missingType,
    invalidProperties,
    isValid: !missingType && invalidProperties.length === 0,
  };
}

/** Collects the unique, sorted type names used in the tree that are missing from the project. */
export function collectMissingTypes(root: TreeNode, project: CompiledProject): MissingTypes {
  const nodes = new Set<string>();
  const decorators = new Set<string>();
  const services = new Set<string>();

  forEachNode(root, (n) => {
    if (getItemType(project, 'node', n.type).isInvalid) {
      nodes.add(n.type);
    }
    for (const d of n.decorators) {
      if (getItemType(project, 'decorator', d.type).isInvalid) {
        decorators.add(d.type);
      }
    }
    for (const s of n.services) {
      if (getItemType(project, 'service', s.type).isInvalid) {
        services.add(s.type);
      }
    }
  });

  return {
    nodes: [...nodes].sort(),
    decorators: [...decorators].sort(),
    services: [...services].sort(),
  };
}

/**
 * Formats missing types as message lines, or null when nothing is missing.
 * e.g. ['Missing node descriptors: A, B']
 */
export function formatMissingTypes(missing: MissingTypes): string[] | null {
  const lines: string[] = [];
  if (missing.nodes.length > 0) {
    lines.push(`Missing node descriptors: ${missing.nodes.join(', ')}`);
  }
  if (missing.decorators.length > 0) {
    lines.push(`Missing decorator descriptors: ${missing.decorators.join(', ')}`);
  }
  if (missing.services.length > 0) {
    lines.push(`Missing service descriptors: ${missing.services.join(', ')}`);
  }
  return lines.length > 0 ? lines : null;
}

/** True when no item uses a missing type and every item's properties are valid. */
export function isTreeValid(root: TreeNode, project: CompiledProject): boolean {
  let valid = true;
  forEachNode(root, (n) => {
    if (!validateItem(getItemType(project, 'node', n.type), n.properties).isValid) {
      valid = false;
    }
    for (const d of n.decorators) {
      if (!validateItem(getItemType(project, 'decorator', d.type), d.properties).isValid) {
        valid = false;
      }
    }
    for (const s of n.services) {
      if (!validateItem(getItemType(project, 'service', s.type), s.properties).isValid) {
        valid = false;
      }
    }
  });
  return valid;
}
