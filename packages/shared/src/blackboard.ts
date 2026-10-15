import type {
  BlackboardKeyJson,
  BlackboardValueType,
  CompiledProject,
  CompiledProperty,
  ItemTypeDescJson,
  ProjectFile,
} from './types';

/*
 * Blackboard key declarations (`blackboard` of owl-bt.json).
 *
 * Rule: a property holds a blackboard key when its type is the custom type `blackboardKey`
 * (BLACKBOARD_KEY_TYPE). Only those properties get key suggestions, the "undeclared key" warning,
 * blackboard key usages and key renames. Every helper that edits a ProjectFile mutates it in place
 * (immer friendly) and leaves unknown fields alone.
 */

/** Name of the custom property type whose values are blackboard key names. */
export const BLACKBOARD_KEY_TYPE = 'blackboardKey';

export const BLACKBOARD_VALUE_TYPES: readonly BlackboardValueType[] = [
  'string',
  'number',
  'bool',
  'any',
];

/** Valid key names: an identifier (letters, digits and _, not starting with a digit). */
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BlackboardIssue {
  /** Location in the file, e.g. `blackboard[2].name`. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/** True for properties whose values are blackboard key names. */
export function isBlackboardKeyProperty(prop: Pick<CompiledProperty, 'customType'>): boolean {
  return prop.customType === BLACKBOARD_KEY_TYPE;
}

/** True for property descriptors (owl-bt.json) that hold blackboard key names. */
export function isBlackboardKeyPropertyDesc(prop: { type?: unknown }): boolean {
  return prop.type === BLACKBOARD_KEY_TYPE;
}

export function isValidBlackboardKeyName(name: string): boolean {
  return KEY_NAME.test(name);
}

/** Start value of a key without a default. */
export function defaultForBlackboardType(type: string): unknown {
  switch (type) {
    case 'number':
      return 0;
    case 'bool':
      return false;
    case 'string':
      return '';
    default:
      return null;
  }
}

/** Start value of a declared key: its default, or the empty value of its type. */
export function blackboardKeyStartValue(key: BlackboardKeyJson): unknown {
  return key.default !== undefined ? key.default : defaultForBlackboardType(key.type);
}

/** True when the value fits the declared type ('any' and unknown types accept everything). */
export function matchesBlackboardType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

/** Declared keys of the file (entries that are not objects are skipped). */
export function getBlackboardKeys(file: ProjectFile): BlackboardKeyJson[] {
  return Array.isArray(file.blackboard)
    ? file.blackboard.filter(
        (entry): entry is BlackboardKeyJson => typeof entry === 'object' && entry !== null,
      )
    : [];
}

/** Declared keys with a string name, for the compiled project. Undefined when none is declared. */
export function compileBlackboard(file: ProjectFile): BlackboardKeyJson[] | undefined {
  const keys = getBlackboardKeys(file).filter(
    (entry) => typeof entry.name === 'string' && entry.name.trim() !== '',
  );
  return keys.length > 0 ? keys : undefined;
}

export function findBlackboardKey(file: ProjectFile, name: string): BlackboardKeyJson | undefined {
  return getBlackboardKeys(file).find((entry) => entry.name === name);
}

/** `base`, `base2`, ... — the first key name that is not declared yet. */
export function uniqueBlackboardKeyName(file: ProjectFile, base = 'Key'): string {
  if (!findBlackboardKey(file, base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!findBlackboardKey(file, candidate)) {
      return candidate;
    }
  }
}

function checkKeyName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new Error('Key name must not be empty');
  }
  if (!isValidBlackboardKeyName(name)) {
    throw new Error(`Invalid key name '${name}': use letters, digits and _`);
  }
  return name;
}

/** Appends a key declaration. Throws for empty, invalid or duplicate names. */
export function addBlackboardKey(file: ProjectFile, key: BlackboardKeyJson): void {
  const name = checkKeyName(key.name);
  if (findBlackboardKey(file, name)) {
    throw new Error(`Duplicate blackboard key '${name}'`);
  }
  if (!Array.isArray(file.blackboard)) {
    file.blackboard = [];
  }
  file.blackboard.push({ ...key, name });
}

/** Removes a key declaration (and the `blackboard` field when it becomes empty). */
export function removeBlackboardKey(
  file: ProjectFile,
  name: string,
): BlackboardKeyJson | undefined {
  const list = file.blackboard;
  const index = Array.isArray(list) ? list.findIndex((entry) => entry?.name === name) : -1;
  if (!list || index < 0) {
    return undefined;
  }
  const [removed] = list.splice(index, 1);
  if (list.length === 0) {
    delete file.blackboard;
  }
  return removed;
}

/** Updates fields of a declaration. Undefined values remove the field. Use renameBlackboardKey for names. */
export function updateBlackboardKey(
  file: ProjectFile,
  name: string,
  patch: Partial<BlackboardKeyJson>,
): void {
  const key = findBlackboardKey(file, name);
  if (!key) {
    throw new Error(`Unknown blackboard key '${name}'`);
  }
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'name') {
      continue;
    }
    if (value === undefined) {
      delete key[field];
    } else {
      key[field] = value;
    }
  }
}

export interface BlackboardRenameResult {
  /** Property defaults (type blackboardKey) that named the key. */
  defaults: number;
  /** Scenarios whose blackboard had the key. */
  scenarios: number;
}

function renameRecordKey(
  record: Record<string, unknown>,
  oldName: string,
  newName: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) =>
      key === oldName ? [newName, value] : [key, value],
    ),
  );
}

/**
 * Renames a declared key and updates the project file references to it: defaults of `blackboardKey`
 * properties and scenario blackboards (when the new name is not used there yet). Trees are updated
 * separately (rewriteTreeReferences).
 */
export function renameBlackboardKey(
  file: ProjectFile,
  oldName: string,
  newName: string,
): BlackboardRenameResult {
  const key = findBlackboardKey(file, oldName);
  if (!key) {
    throw new Error(`Unknown blackboard key '${oldName}'`);
  }
  const target = checkKeyName(newName);
  const result: BlackboardRenameResult = { defaults: 0, scenarios: 0 };
  if (target === oldName) {
    return result;
  }
  if (findBlackboardKey(file, target)) {
    throw new Error(`Duplicate blackboard key '${target}'`);
  }
  key.name = target;

  const lists: Array<ItemTypeDescJson[] | undefined> = [file.nodes, file.decorators, file.services];
  for (const list of lists) {
    for (const desc of list ?? []) {
      for (const prop of desc.properties ?? []) {
        if (isBlackboardKeyPropertyDesc(prop) && prop.default === oldName) {
          prop.default = target;
          result.defaults++;
        }
      }
    }
  }
  for (const scenario of file.scenarios ?? []) {
    const bb = scenario.blackboard;
    if (
      typeof bb === 'object' &&
      bb !== null &&
      Object.hasOwn(bb, oldName) &&
      !Object.hasOwn(bb, target)
    ) {
      scenario.blackboard = renameRecordKey(bb, oldName, target);
      result.scenarios++;
    }
  }
  return result;
}

/** Problems of the `blackboard` declarations (paths `blackboard[i].field`). */
export function validateBlackboardDeclarations(file: ProjectFile): BlackboardIssue[] {
  const issues: BlackboardIssue[] = [];
  const raw: unknown = file.blackboard;
  if (raw === undefined) {
    return issues;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: 'blackboard', message: 'blackboard must be an array', severity: 'error' });
    return issues;
  }
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const path = `blackboard[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push({ path, message: 'Blackboard key must be an object', severity: 'error' });
      return;
    }
    const key = entry as BlackboardKeyJson;
    const name = typeof key.name === 'string' ? key.name : '';
    if (name.trim() === '') {
      issues.push({ path: `${path}.name`, message: 'Key name is required', severity: 'error' });
    } else if (!isValidBlackboardKeyName(name)) {
      issues.push({
        path: `${path}.name`,
        message: `Invalid key name '${name}': use letters, digits and _ (not starting with a digit)`,
        severity: 'error',
      });
    } else if (seen.has(name)) {
      issues.push({
        path: `${path}.name`,
        message: `Duplicate blackboard key '${name}'`,
        severity: 'error',
      });
    } else {
      seen.add(name);
    }
    const type = key.type;
    if (typeof type !== 'string' || !BLACKBOARD_VALUE_TYPES.includes(type as BlackboardValueType)) {
      issues.push({
        path: `${path}.type`,
        message: `Unknown blackboard key type '${String(type)}'`,
        severity: 'warning',
      });
    } else if (key.default !== undefined && !matchesBlackboardType(type, key.default)) {
      issues.push({
        path: `${path}.default`,
        message: `Default of '${name}' is not a ${type}`,
        severity: 'error',
      });
    }
  });
  return issues;
}

/**
 * True when the project declares keys, the property holds a key name and the (non-empty string)
 * value is not one of the declared keys. Such values are reported as warnings, not errors.
 */
export function isUndeclaredBlackboardKey(
  project: Pick<CompiledProject, 'blackboard'>,
  prop: Pick<CompiledProperty, 'customType'>,
  value: unknown,
): boolean {
  const declared = project.blackboard;
  if (!declared || declared.length === 0 || !isBlackboardKeyProperty(prop)) {
    return false;
  }
  if (typeof value !== 'string' || value === '') {
    return false;
  }
  return !declared.some((key) => key.name === value);
}
