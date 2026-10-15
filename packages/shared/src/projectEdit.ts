import { validateBlackboardDeclarations } from './blackboard';
import { resolveProperty } from './compileProject';
import { validatePropertyValue } from './validation';
import { validateSimulate } from './runtime/simulateValidation';
import { validateScenarioTestFields } from './runtime/scenarioTest';
import type {
  CustomTypeJson,
  ItemKind,
  ItemTypeDescJson,
  ProjectFile,
  PropertyDescJson,
  ScenarioJson,
} from './types';

/*
 * Edit helpers for a ProjectFile (owl-bt.json). Every helper mutates the file in place, so they can
 * run on an immer draft. Unknown fields are never touched. Errors are thrown as plain Errors for
 * invalid operations (unknown type, duplicate name); callers check before calling when they need to.
 */

export type ListKey = 'nodes' | 'decorators' | 'services';

export const LIST_KEY: Record<ItemKind, ListKey> = {
  node: 'nodes',
  decorator: 'decorators',
  service: 'services',
};

/** Property types that are always available (custom types are added in ProjectFile.types). */
export const BASE_PROPERTY_TYPES: readonly string[] = ['string', 'number', 'bool', 'enum'];

export type ProjectIssueSeverity = 'error' | 'warning';

export interface ProjectIssue {
  /** Location in the file, e.g. `nodes[2].properties[0].default` or `types.blackboardKey.pattern`. */
  path: string;
  message: string;
  severity: ProjectIssueSeverity;
}

export interface EffectiveProperty {
  prop: PropertyDescJson;
  /** Name of the type that declares the property. Undefined when the type declares it itself. */
  from?: string;
}

/** The list of descriptors of one kind. Empty when the file has none. */
export function getTypes(file: ProjectFile, kind: ItemKind): ItemTypeDescJson[] {
  return file[LIST_KEY[kind]] ?? [];
}

export function findType(
  file: ProjectFile,
  kind: ItemKind,
  name: string,
): ItemTypeDescJson | undefined {
  return getTypes(file, kind).find((desc) => desc.name === name);
}

export function isTypeNameTaken(file: ProjectFile, kind: ItemKind, name: string): boolean {
  return findType(file, kind, name) !== undefined;
}

/** `base`, `base 2`, ... — first candidate that no type of the kind uses. */
export function uniqueTypeName(file: ProjectFile, kind: ItemKind, base: string): string {
  if (!isTypeNameTaken(file, kind, base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!isTypeNameTaken(file, kind, candidate)) {
      return candidate;
    }
  }
}

function ensureList(file: ProjectFile, kind: ItemKind): ItemTypeDescJson[] {
  const key = LIST_KEY[kind];
  if (!file[key]) {
    file[key] = [];
  }
  return file[key];
}

function requireType(file: ProjectFile, kind: ItemKind, name: string): ItemTypeDescJson {
  const desc = findType(file, kind, name);
  if (!desc) {
    throw new Error(`Unknown ${kind} type '${name}'`);
  }
  return desc;
}

function requireIndex(length: number, index: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`${what} index ${index} is out of range`);
  }
}

function basesOf(desc: ItemTypeDescJson): string[] {
  if (desc.base === undefined || desc.base === '') {
    return [];
  }
  return Array.isArray(desc.base) ? [...desc.base] : [desc.base];
}

/** Bases of a type as an array (empty when it has none). */
export function getBases(desc: ItemTypeDescJson): string[] {
  return basesOf(desc);
}

/**
 * Names that cannot be used for types: they collide with Object.prototype members when a type name
 * is used as an object key.
 */
export const RESERVED_TYPE_NAMES: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** The trimmed type name. Throws for empty, whitespace-only and reserved names. */
export function checkTypeName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new Error('Type name must not be empty');
  }
  if (RESERVED_TYPE_NAMES.includes(name)) {
    throw new Error(`Type name '${name}' is reserved`);
  }
  return name;
}

/** Appends the type, or inserts it at `index`. Throws on empty, reserved or duplicate names. */
export function addType(
  file: ProjectFile,
  kind: ItemKind,
  desc: ItemTypeDescJson,
  index?: number,
): void {
  const name = checkTypeName(desc.name);
  if (isTypeNameTaken(file, kind, name)) {
    throw new Error(`Duplicate type name '${name}'`);
  }
  // Stores a copy with the trimmed name; the caller's descriptor is left as it was passed in.
  const stored: ItemTypeDescJson = { ...desc, name };
  const list = ensureList(file, kind);
  if (index === undefined || index < 0 || index >= list.length) {
    list.push(stored);
  } else {
    list.splice(index, 0, stored);
  }
}

/** Removes the type. References from other types are left as they are. */
export function removeType(
  file: ProjectFile,
  kind: ItemKind,
  name: string,
): ItemTypeDescJson | undefined {
  const list = getTypes(file, kind);
  const index = list.findIndex((desc) => desc.name === name);
  if (index < 0) {
    return undefined;
  }
  const [removed] = list.splice(index, 1);
  return removed;
}

/**
 * Renames a type and updates the `base` references to it in the same kind.
 * Returns the number of base references that were updated.
 */
export function renameType(
  file: ProjectFile,
  kind: ItemKind,
  oldName: string,
  newName: string,
): number {
  const desc = requireType(file, kind, oldName);
  const target = checkTypeName(newName);
  if (target === oldName) {
    return 0;
  }
  if (isTypeNameTaken(file, kind, target)) {
    throw new Error(`Duplicate type name '${target}'`);
  }

  desc.name = target;
  let updated = 0;
  for (const other of getTypes(file, kind)) {
    if (typeof other.base === 'string') {
      if (other.base === oldName) {
        other.base = target;
        updated++;
      }
    } else if (Array.isArray(other.base)) {
      other.base = other.base.map((base) => {
        if (base !== oldName) {
          return base;
        }
        updated++;
        return target;
      });
    }
  }
  return updated;
}

/** Copies the type right after the original as `<name> copy` (numbered when taken). Returns the new name. */
export function duplicateType(file: ProjectFile, kind: ItemKind, name: string): string {
  const list = ensureList(file, kind);
  const index = list.findIndex((desc) => desc.name === name);
  if (index < 0) {
    throw new Error(`Unknown ${kind} type '${name}'`);
  }
  const copy = JSON.parse(JSON.stringify(list[index])) as ItemTypeDescJson;
  copy.name = uniqueTypeName(file, kind, `${name} copy`);
  list.splice(index + 1, 0, copy);
  return copy.name;
}

/** Moves a type from one index to another within its kind. */
export function moveType(file: ProjectFile, kind: ItemKind, from: number, to: number): void {
  const list = ensureList(file, kind);
  requireIndex(list.length, from, 'Source');
  requireIndex(list.length, to, 'Target');
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
}

/** Names of the types of the same kind that derive from `name` (directly or with several bases). */
export function findTypeReferences(file: ProjectFile, kind: ItemKind, name: string): string[] {
  return getTypes(file, kind)
    .filter((desc) => desc.name !== name && basesOf(desc).includes(name))
    .map((desc) => desc.name);
}

/** Sets, replaces or (for undefined values) removes fields of a type. The name is not changed here. */
export function updateType(
  file: ProjectFile,
  kind: ItemKind,
  name: string,
  patch: Partial<ItemTypeDescJson>,
): void {
  const desc = requireType(file, kind, name);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'name') {
      continue;
    }
    if (value === undefined) {
      delete desc[key];
    } else {
      desc[key] = value;
    }
  }
}

function findProperty(desc: ItemTypeDescJson, propName: string): number {
  return (desc.properties ?? []).findIndex((prop) => prop.name === propName);
}

/** Adds a property to a type, appended or inserted at `index`. Throws on duplicate or empty names. */
export function addProperty(
  file: ProjectFile,
  kind: ItemKind,
  typeName: string,
  prop: PropertyDescJson,
  index?: number,
): void {
  const desc = requireType(file, kind, typeName);
  const name = prop.name.trim();
  if (name === '') {
    throw new Error('Property name must not be empty');
  }
  if (findProperty(desc, name) >= 0) {
    throw new Error(`Duplicate property '${name}'`);
  }
  if (!desc.properties) {
    desc.properties = [];
  }
  // Stores a copy with the trimmed name; the caller's descriptor is left as it was passed in.
  const stored: PropertyDescJson = { ...prop, name };
  if (index === undefined || index < 0 || index >= desc.properties.length) {
    desc.properties.push(stored);
  } else {
    desc.properties.splice(index, 0, stored);
  }
}

/** Removes a property of the type. Returns the removed property. */
export function removeProperty(
  file: ProjectFile,
  kind: ItemKind,
  typeName: string,
  propName: string,
): PropertyDescJson | undefined {
  const desc = requireType(file, kind, typeName);
  const index = findProperty(desc, propName);
  if (index < 0 || !desc.properties) {
    return undefined;
  }
  const [removed] = desc.properties.splice(index, 1);
  return removed;
}

export function moveProperty(
  file: ProjectFile,
  kind: ItemKind,
  typeName: string,
  from: number,
  to: number,
): void {
  const desc = requireType(file, kind, typeName);
  const props = desc.properties ?? [];
  requireIndex(props.length, from, 'Source');
  requireIndex(props.length, to, 'Target');
  const [moved] = props.splice(from, 1);
  props.splice(to, 0, moved);
  desc.properties = props;
}

/**
 * Updates fields of a property. Undefined values remove the field. Renaming to an existing
 * property name of the same type throws.
 */
export function updateProperty(
  file: ProjectFile,
  kind: ItemKind,
  typeName: string,
  propName: string,
  patch: Partial<PropertyDescJson>,
): void {
  const desc = requireType(file, kind, typeName);
  const index = findProperty(desc, propName);
  if (index < 0 || !desc.properties) {
    throw new Error(`Unknown property '${propName}' of '${typeName}'`);
  }
  const prop = desc.properties[index];
  if (typeof patch.name === 'string') {
    const renamed = patch.name.trim();
    if (renamed === '') {
      throw new Error('Property name must not be empty');
    }
    if (renamed !== propName && findProperty(desc, renamed) >= 0) {
      throw new Error(`Duplicate property '${renamed}'`);
    }
    patch = { ...patch, name: renamed };
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete prop[key];
    } else {
      prop[key] = value;
    }
  }
}

/** Sets or creates a custom type. Throws for empty, whitespace-only and reserved names. */
export function setCustomType(file: ProjectFile, name: string, custom: CustomTypeJson): void {
  const key = checkTypeName(name);
  if (!file.types) {
    file.types = {};
  }
  file.types[key] = custom;
}

/** Removes a custom type. Properties that still use it keep the name (validation reports them). */
export function removeCustomType(file: ProjectFile, name: string): CustomTypeJson | undefined {
  if (!file.types || !Object.hasOwn(file.types, name)) {
    return undefined;
  }
  const removed = file.types[name];
  delete file.types[name];
  return removed;
}

/**
 * Renames a custom type (keeping its position) and updates the `type` of every property that
 * uses it. Returns the number of properties updated.
 */
export function renameCustomType(file: ProjectFile, oldName: string, newName: string): number {
  if (!file.types || !Object.hasOwn(file.types, oldName)) {
    throw new Error(`Unknown custom type '${oldName}'`);
  }
  const target = checkTypeName(newName);
  if (target === oldName) {
    return 0;
  }
  if (Object.hasOwn(file.types, target)) {
    throw new Error(`Duplicate custom type '${target}'`);
  }

  const entries = Object.entries(file.types).map(([key, value]) =>
    key === oldName ? ([target, value] as const) : ([key, value] as const),
  );
  file.types = Object.fromEntries(entries);

  let updated = 0;
  for (const kind of ['node', 'decorator', 'service'] as const) {
    for (const desc of getTypes(file, kind)) {
      for (const prop of desc.properties ?? []) {
        if (prop.type === oldName) {
          prop.type = target;
          updated++;
        }
      }
    }
  }
  return updated;
}

/**
 * Own and inherited properties of a type, in display order: inherited properties first (base order),
 * then the type's own. A property redeclared by a derived type keeps the position of the base one.
 */
export function listEffectiveProperties(
  file: ProjectFile,
  kind: ItemKind,
  name: string,
): EffectiveProperty[] {
  const result: EffectiveProperty[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const add = (desc: ItemTypeDescJson, owner: string) => {
    for (const prop of desc.properties ?? []) {
      const from = owner === name ? undefined : owner;
      const index = result.findIndex((entry) => entry.prop.name === prop.name);
      if (index >= 0) {
        result[index] = { prop, from };
      } else {
        result.push({ prop, from });
      }
    }
  };

  const visit = (typeName: string): void => {
    if (visited.has(typeName) || visiting.has(typeName)) {
      return;
    }
    const desc = findType(file, kind, typeName);
    if (!desc) {
      return;
    }
    visiting.add(typeName);
    for (const base of basesOf(desc)) {
      visit(base);
    }
    visiting.delete(typeName);
    visited.add(typeName);
    add(desc, typeName);
  };

  visit(name);
  return result;
}

interface Located {
  kind: ItemKind;
  index: number;
  desc: ItemTypeDescJson;
}

const SEVERITY_ERROR: ProjectIssueSeverity = 'error';

/** Checks a project file for problems the editor reports. Errors that make compileProject throw block saving. */
export function validateProjectFile(file: ProjectFile): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const push = (path: string, message: string, severity: ProjectIssueSeverity = SEVERITY_ERROR) => {
    issues.push({ path, message, severity });
  };
  const customTypes = file.types ?? {};

  for (const [name, custom] of Object.entries(customTypes)) {
    const path = `types.${name}`;
    if (name.trim() === '' || RESERVED_TYPE_NAMES.includes(name.trim())) {
      push(path, `Type name '${name}' is ${name.trim() === '' ? 'empty' : 'reserved'}`);
    }
    if (custom.type !== 'string' && custom.type !== 'number') {
      push(`${path}.type`, `Custom type '${name}' must be 'string' or 'number'`);
    }
    if (custom.pattern !== undefined) {
      try {
        new RegExp(`^(?:${custom.pattern})$`);
      } catch (e) {
        push(`${path}.pattern`, `Invalid pattern: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  for (const kind of ['node', 'decorator', 'service'] as const) {
    const list = getTypes(file, kind);
    const key = LIST_KEY[kind];
    const byName = new Map<string, Located>();

    list.forEach((desc, index) => {
      const path = `${key}[${index}]`;
      const name = typeof desc.name === 'string' ? desc.name.trim() : '';
      if (name === '') {
        push(`${path}.name`, 'Name is required');
      } else if (RESERVED_TYPE_NAMES.includes(name)) {
        push(`${path}.name`, `Type name '${name}' is reserved`);
      } else if (byName.has(desc.name)) {
        push(`${path}.name`, `Duplicate type name '${desc.name}'`);
      } else {
        byName.set(desc.name, { kind, index, desc });
      }
    });

    list.forEach((desc, index) => {
      const path = `${key}[${index}]`;
      for (const base of basesOf(desc)) {
        if (!byName.has(base)) {
          push(`${path}.base`, `Missing base '${base}'`);
        }
      }
    });

    reportCycles(list, byName, key, push);

    list.forEach((desc, index) => {
      const path = `${key}[${index}]`;
      const seen = new Set<string>();
      (desc.properties ?? []).forEach((prop, propIndex) => {
        const propPath = `${path}.properties[${propIndex}]`;
        const propName = typeof prop.name === 'string' ? prop.name.trim() : '';
        if (propName === '') {
          push(`${propPath}.name`, 'Property name is required');
        } else if (seen.has(prop.name)) {
          push(`${propPath}.name`, `Duplicate property '${prop.name}'`);
        } else {
          seen.add(prop.name);
        }

        if (typeof prop.type !== 'string' || prop.type === '') {
          push(`${propPath}.type`, 'Property type is required');
        } else if (
          !BASE_PROPERTY_TYPES.includes(prop.type) &&
          !Object.hasOwn(customTypes, prop.type)
        ) {
          push(`${propPath}.type`, `Unknown property type '${prop.type}'`, 'warning');
        }

        if (prop.type === 'enum' && (!Array.isArray(prop.values) || prop.values.length === 0)) {
          push(`${propPath}.values`, 'Enum needs at least one value');
        }
        if (typeof prop.min === 'number' && typeof prop.max === 'number' && prop.min > prop.max) {
          push(`${propPath}.min`, 'min is greater than max');
        }
        if (prop.default !== undefined && !isDefaultValid(prop, customTypes)) {
          push(`${propPath}.default`, defaultMessage(prop));
        }
      });
      for (const issue of validateSimulate(desc.simulate)) {
        push(`${path}.simulate${issue.field ? '.' + issue.field : ''}`, issue.message);
      }
    });
  }

  const scenarioNames = new Set<string>();
  (file.scenarios ?? []).forEach((scenario, index) => {
    const path = `scenarios[${index}]`;
    const name = typeof scenario.name === 'string' ? scenario.name.trim() : '';
    if (name === '') {
      push(`${path}.name`, 'Scenario name is required');
    } else if (scenarioNames.has(name)) {
      push(`${path}.name`, `Duplicate scenario name '${name}'`);
    } else {
      scenarioNames.add(name);
    }
    const bb = scenario.blackboard;
    if (typeof bb !== 'object' || bb === null || Array.isArray(bb)) {
      push(`${path}.blackboard`, 'Scenario blackboard must be an object');
    }
    for (const issue of validateScenarioTestFields(scenario)) {
      push(`${path}.${issue.field}`, issue.message, issue.severity);
    }
  });

  issues.push(...validateBlackboardDeclarations(file));
  return issues;
}

function reportCycles(
  list: ItemTypeDescJson[],
  byName: Map<string, Located>,
  key: ListKey,
  push: (path: string, message: string) => void,
): void {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (name: string): void => {
    const current = state.get(name);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      const members = stack.slice(stack.indexOf(name));
      const chain = [...members, name].join(' -> ');
      for (const member of members) {
        if (reported.has(member)) {
          continue;
        }
        reported.add(member);
        const located = byName.get(member);
        if (located) {
          push(`${key}[${located.index}].base`, `Inheritance cycle: ${chain}`);
        }
      }
      return;
    }
    const located = byName.get(name);
    if (!located) {
      return;
    }
    state.set(name, 'visiting');
    stack.push(name);
    for (const base of basesOf(located.desc)) {
      if (byName.has(base)) {
        visit(base);
      }
    }
    stack.pop();
    state.set(name, 'done');
  };

  for (const desc of list) {
    if (typeof desc.name === 'string' && byName.has(desc.name)) {
      visit(desc.name);
    }
  }
}

function isDefaultValid(
  prop: PropertyDescJson,
  customTypes: Record<string, CustomTypeJson>,
): boolean {
  return validatePropertyValue(resolveProperty(prop, customTypes), prop.default);
}

function defaultMessage(prop: PropertyDescJson): string {
  if (prop.type === 'enum') {
    return `Default '${String(prop.default)}' is not one of the enum values`;
  }
  if (typeof prop.default === 'number' && (prop.min !== undefined || prop.max !== undefined)) {
    return `Default ${prop.default} is outside min/max`;
  }
  if (prop.type === 'bool' && typeof prop.default !== 'boolean') {
    return 'Default must be true or false';
  }
  if (prop.type === 'number' && typeof prop.default !== 'number') {
    return 'Default must be a number';
  }
  return 'Default does not match the property type or pattern';
}

/** True when `base` is another type of the kind and making it a base of `name` creates no cycle. */
export function canAddBase(file: ProjectFile, kind: ItemKind, name: string, base: string): boolean {
  if (base === name || !isTypeNameTaken(file, kind, base)) {
    return false;
  }
  const seen = new Set<string>();
  const pending = [base];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (current === name) {
      return false;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const desc = findType(file, kind, current);
    if (desc) {
      pending.push(...basesOf(desc));
    }
  }
  return true;
}

/** Replaces the bases of a type. One base is stored as a string, several as an array, none removes the field. */
export function setBases(file: ProjectFile, kind: ItemKind, name: string, bases: string[]): void {
  const unique = [...new Set(bases)];
  updateType(file, kind, name, {
    base: unique.length === 0 ? undefined : unique.length === 1 ? unique[0] : unique,
  });
}

// ---------- Scenarios (run mode) ----------

export function getScenarios(file: ProjectFile): ScenarioJson[] {
  return file.scenarios ?? [];
}

export function findScenario(file: ProjectFile, name: string): ScenarioJson | undefined {
  return getScenarios(file).find((scenario) => scenario.name === name);
}

/** `base`, `base 2`, ... — first scenario name that is not used yet. */
export function uniqueScenarioName(file: ProjectFile, base: string): string {
  if (!findScenario(file, base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!findScenario(file, candidate)) {
      return candidate;
    }
  }
}

/** Appends a scenario. Throws for empty or duplicate names. */
export function addScenario(file: ProjectFile, scenario: ScenarioJson): void {
  const name = scenario.name.trim();
  if (name === '') {
    throw new Error('Scenario name must not be empty');
  }
  if (findScenario(file, name)) {
    throw new Error(`Duplicate scenario name '${name}'`);
  }
  if (!file.scenarios) {
    file.scenarios = [];
  }
  file.scenarios.push({ ...scenario, name });
}

/** Removes the scenario (and the `scenarios` field when it becomes empty). */
export function removeScenario(file: ProjectFile, name: string): ScenarioJson | undefined {
  const list = file.scenarios;
  const index = list ? list.findIndex((scenario) => scenario.name === name) : -1;
  if (!list || index < 0) {
    return undefined;
  }
  const [removed] = list.splice(index, 1);
  if (list.length === 0) {
    delete file.scenarios;
  }
  return removed;
}

/** Updates a scenario. Undefined values remove the field; renaming to a taken name throws. */
export function updateScenario(
  file: ProjectFile,
  name: string,
  patch: Partial<ScenarioJson>,
): void {
  const scenario = findScenario(file, name);
  if (!scenario) {
    throw new Error(`Unknown scenario '${name}'`);
  }
  if (typeof patch.name === 'string') {
    const renamed = patch.name.trim();
    if (renamed === '') {
      throw new Error('Scenario name must not be empty');
    }
    if (renamed !== name && findScenario(file, renamed)) {
      throw new Error(`Duplicate scenario name '${renamed}'`);
    }
    patch = { ...patch, name: renamed };
  }
  const target = scenario as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}
