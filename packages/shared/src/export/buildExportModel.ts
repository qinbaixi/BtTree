import { getItemType } from '../compileProject';
import type {
  CompiledItemType,
  CompiledProject,
  CompiledProperty,
  ItemKind,
  SubItem,
  TreeNode,
} from '../types';
import { getEffectiveValue, validatePropertyValue } from '../validation';
import { atom, ExportError, toExportValue } from './model';
import type { ExportEntry, ExportField, ExportModel, ExportValue } from './model';
import { snakeCase } from './names';
import { numberTree, type NumberedItem } from './numberTree';

const KIND_LABEL: Record<ItemKind, string> = {
  node: 'node',
  decorator: 'decorator',
  service: 'service',
};

/** Exported `type`: the type's override, otherwise composite / task for nodes, the kind for sub items. */
function exportedType(kind: ItemKind, type: CompiledItemType): string {
  if (type.export?.type !== undefined) {
    return type.export.type;
  }
  if (kind === 'node') {
    return type.isComposite ? 'composite' : 'task';
  }
  return kind;
}

/** Exported `sub_type`: the override (numbers stay numbers), otherwise the type name in snake_case. */
function exportedSubType(type: CompiledItemType): ExportValue {
  const subType = type.export?.subType;
  if (subType === undefined) {
    return atom(snakeCase(type.name));
  }
  return typeof subType === 'number' ? subType : atom(subType);
}

/** `<Type>` or `<Type> - <label>`. Falls back to the comment when there is no label. */
function commentOf(type: CompiledItemType, item: TreeNode | SubItem): string {
  const label = (item.label ?? item.comment ?? '').replace(/[\r\n]+/g, ' ').trim();
  return label === '' ? type.name : `${type.name} - ${label}`;
}

function propertyValue(prop: CompiledProperty, value: unknown): ExportValue {
  if (prop.type === 'enum' && typeof value === 'string') {
    return atom(value);
  }
  return toExportValue(value);
}

function idList(items: object[], idOf: Map<object, number>): ExportValue {
  return items.map((item) => idOf.get(item) ?? 0);
}

/** Fields that are the same for every item of a type, computed once per type and export. */
interface TypeFields {
  type: ExportValue;
  subType: ExportValue;
  /** Constant `export.fields` of the type. */
  constants: ExportField[];
  /** The type declares a property that goes to `properties` (not to the node's top level). */
  declaresProperties: boolean;
}

function typeFieldsOf(kind: ItemKind, type: CompiledItemType): TypeFields {
  const constants: ExportField[] = [];
  for (const [key, value] of Object.entries(type.export?.fields ?? {})) {
    if (value !== undefined) {
      constants.push([key, toExportValue(value)]);
    }
  }
  return {
    type: atom(exportedType(kind, type)),
    subType: exportedSubType(type),
    constants,
    declaresProperties: type.properties.some((prop) => prop.exportTo !== 'node'),
  };
}

function buildEntry(
  numbered: NumberedItem,
  project: CompiledProject,
  idOf: Map<object, number>,
  typeFields: Map<CompiledItemType, TypeFields>,
  warnings: string[],
): ExportEntry {
  const { id, kind, item, path } = numbered;
  const type = getItemType(project, kind, item.type);
  if (type.isInvalid) {
    throw new ExportError(`Missing ${KIND_LABEL[kind]} type '${item.type}' at ${path}`);
  }
  let shared = typeFields.get(type);
  if (!shared) {
    shared = typeFieldsOf(kind, type);
    typeFields.set(type, shared);
  }

  const fields: ExportField[] = [
    ['node_id', id],
    ['type', shared.type],
    ['sub_type', shared.subType],
  ];

  if (kind === 'decorator') {
    const decorator = item as SubItem;
    fields.push(['inverse_check_condition', decorator.inverseCheckCondition === true]);
    if (decorator.periodic === true) {
      fields.push(['periodic', true]);
    }
  } else if (kind === 'service') {
    const service = item as SubItem;
    if (service.timeBetweenTicks != null) {
      fields.push(['time_between_ticks', toExportValue(service.timeBetweenTicks)]);
    }
    if (service.firstTickTime != null) {
      fields.push(['first_tick_time', toExportValue(service.firstTickTime)]);
    }
  }

  fields.push(...shared.constants);

  // Property values are the effective values (explicit value, else the declared default).
  const nodeFields: ExportField[] = [];
  const propertyFields: ExportField[] = [];
  for (const prop of type.properties) {
    const value = getEffectiveValue(prop, item.properties);
    if (value === undefined || value === null) {
      continue;
    }
    if (!validatePropertyValue(prop, value)) {
      warnings.push(`${path}: invalid value for property '${prop.name}'`);
    }
    const field: ExportField = [prop.exportName ?? prop.name, propertyValue(prop, value)];
    if (prop.exportTo === 'node') {
      nodeFields.push(field);
    } else {
      propertyFields.push(field);
    }
  }
  fields.push(...nodeFields);

  if (kind === 'node') {
    const node = item as TreeNode;
    fields.push(['decorators', idList(node.decorators, idOf)]);
    fields.push(['services', idList(node.services, idOf)]);
    if (!type.isComposite || shared.declaresProperties) {
      fields.push(['properties', { map: propertyFields }]);
    }
    if (type.isComposite) {
      fields.push(['children', idList(node.childNodes, idOf)]);
    }
  } else {
    fields.push(['properties', { map: propertyFields }]);
  }

  return { id, kind, comment: commentOf(type, item), fields };
}

/**
 * Builds the export model of a tree: numbered entries with their ordered fields.
 * Throws ExportError when an item uses a type that is missing from the project.
 * Invalid property values are exported as they are and reported as warnings.
 */
export function buildExportModel(root: TreeNode, project: CompiledProject): ExportModel {
  const numbered = numberTree(root);
  const idOf = new Map<object, number>();
  for (const entry of numbered) {
    idOf.set(entry.item, entry.id);
  }

  const warnings: string[] = [];
  const typeFields = new Map<CompiledItemType, TypeFields>();
  const entries = numbered.map((entry) => buildEntry(entry, project, idOf, typeFields, warnings));
  return { rootId: idOf.get(root) ?? 1, entries, warnings };
}
