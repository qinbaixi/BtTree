import type { CustomTypeJson, ItemKind, ItemTypeDescJson, ProjectFile } from './types';

/**
 * Types added to the default project template after projects were created from it. Projects made
 * from an older template miss them; `findMissingBuiltins` lists them and `addMissingBuiltins` copies
 * their definitions from the current template. Types the user removed on purpose come back only
 * when asked (the editor offers them, it never adds them silently).
 */
export const BUILTIN_TYPE_ADDITIONS: ReadonlyArray<{
  kind: ItemKind;
  name: string;
  since: string;
}> = [
  { kind: 'node', name: 'UtilitySelector', since: '0.3.2' },
  { kind: 'decorator', name: 'Utility', since: '0.3.2' },
  { kind: 'decorator', name: 'Consideration', since: '0.3.2' },
];

export interface MissingBuiltin {
  kind: ItemKind;
  name: string;
}

const LIST_OF: Record<ItemKind, 'nodes' | 'decorators' | 'services'> = {
  node: 'nodes',
  decorator: 'decorators',
  service: 'services',
};

function hasType(project: ProjectFile, kind: ItemKind, name: string): boolean {
  const list = project[LIST_OF[kind]];
  return Array.isArray(list) && list.some((item) => item?.name === name);
}

function templateType(
  template: ProjectFile,
  kind: ItemKind,
  name: string,
): ItemTypeDescJson | undefined {
  return template[LIST_OF[kind]]?.find((item) => item.name === name);
}

/** Built-in types of the template that the project does not define (by name). */
export function findMissingBuiltins(project: ProjectFile, template: ProjectFile): MissingBuiltin[] {
  return BUILTIN_TYPE_ADDITIONS.filter(
    ({ kind, name }) =>
      !hasType(project, kind, name) && templateType(template, kind, name) !== undefined,
  ).map(({ kind, name }) => ({ kind, name }));
}

/** Names of custom property types (`types` of owl-bt.json) that an item type uses. */
function customTypesOf(item: ItemTypeDescJson, template: ProjectFile): string[] {
  const custom = template.types ?? {};
  return (item.properties ?? [])
    .map((prop) => prop.type)
    .filter((type) => Object.hasOwn(custom, type));
}

/**
 * Returns a copy of the project with the missing built-in types appended (definitions from the
 * template), plus the custom property types they need when the project lacks them. Everything else
 * stays as it is. `added` lists what was added.
 */
/** Deep copy of plain JSON data (the shared package targets plain ES, without structuredClone). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function addMissingBuiltins(
  project: ProjectFile,
  template: ProjectFile,
): { project: ProjectFile; added: MissingBuiltin[]; addedCustomTypes: string[] } {
  const missing = findMissingBuiltins(project, template);
  const next: ProjectFile = { ...project };
  const addedCustomTypes: string[] = [];
  for (const { kind, name } of missing) {
    const item = clone(templateType(template, kind, name)!);
    const key = LIST_OF[kind];
    next[key] = [...(next[key] ?? []), item];
    for (const typeName of customTypesOf(item, template)) {
      if (next.types?.[typeName] === undefined && !addedCustomTypes.includes(typeName)) {
        const custom = template.types![typeName] as CustomTypeJson;
        next.types = { ...(next.types ?? {}), [typeName]: clone(custom) };
        addedCustomTypes.push(typeName);
      }
    }
  }
  return { project: next, added: missing, addedCustomTypes };
}
