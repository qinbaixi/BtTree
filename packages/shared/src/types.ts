// ---------- Project file (owl-bt.json) ----------

export interface PropertyDescJson {
  name: string;
  /** 'string' | 'number' | 'bool' | 'enum' | <custom type name from ProjectFile.types> */
  type: string;
  default?: unknown;
  values?: string[];
  min?: number;
  max?: number;
  description?: string;
  [key: string]: unknown;
}

export interface CustomTypeJson {
  type: 'string' | 'number';
  pattern?: string;
}

export interface ItemTypeDescJson {
  name: string;
  base?: string | string[];
  isAbstract?: boolean;
  icon?: string;
  color?: string;
  /** Template with {{PropName}} placeholders. */
  description?: string;
  properties?: PropertyDescJson[];
  /** Nodes only. */
  isComposite?: boolean;
  [key: string]: unknown;
}

export interface ProjectFile {
  types?: Record<string, CustomTypeJson>;
  nodes?: ItemTypeDescJson[];
  decorators?: ItemTypeDescJson[];
  services?: ItemTypeDescJson[];
}

// ---------- Compiled project ----------

export type ItemKind = 'node' | 'decorator' | 'service';
export type SubItemKind = 'decorator' | 'service';

export interface CompiledProperty {
  name: string;
  /** Effective editor type after resolving custom types. */
  type: 'string' | 'number' | 'bool' | 'enum';
  /** The type name written in the project file (e.g. 'myString'), if it was a custom type. */
  customType?: string;
  default?: unknown;
  values?: string[];
  min?: number;
  max?: number;
  /** Regex source from the custom type (not anchored). */
  pattern?: string;
  description?: string;
}

export interface CompiledItemType {
  kind: ItemKind;
  name: string;
  icon?: string;
  /** Always set: explicit color or the default for the kind. */
  color: string;
  description?: string;
  /** Nodes only; false for decorators/services. */
  isComposite: boolean;
  properties: CompiledProperty[];
  /** True for fallback descriptors of types missing from the project file. */
  isInvalid?: boolean;
}

export interface CompiledProject {
  nodes: Record<string, CompiledItemType>;
  decorators: Record<string, CompiledItemType>;
  services: Record<string, CompiledItemType>;
}

// ---------- Tree file ----------

export interface PropertyValueJson {
  name: string;
  value: unknown;
}

export interface SubItemJson {
  type: string;
  properties?: PropertyValueJson[];
  label?: string;
  comment?: string;
  /** decorators */
  periodic?: boolean;
  inverseCheckCondition?: boolean;
  /** services */
  timeBetweenTicks?: number;
  firstTickTime?: number;
  [key: string]: unknown;
}

export interface TreeNodeJson {
  type: string;
  name?: string;
  label?: string;
  comment?: string;
  properties?: PropertyValueJson[];
  decorators?: SubItemJson[];
  services?: SubItemJson[];
  childNodes?: TreeNodeJson[];
  [key: string]: unknown;
}

// ---------- Runtime tree model (plain data, immer friendly) ----------

/**
 * Base (non-custom) properties editable in the details panel.
 * Stored directly on the item; deleted when set to null/undefined.
 */
export type BasePropertyName =
  'label' | 'comment' | 'periodic' | 'inverseCheckCondition' | 'timeBetweenTicks' | 'firstTickTime';

export interface SubItem {
  id: string;
  type: string;
  /** Only explicitly set custom property values. */
  properties: Record<string, unknown>;
  label?: string;
  comment?: string;
  periodic?: boolean;
  inverseCheckCondition?: boolean;
  timeBetweenTicks?: number;
  firstTickTime?: number;
  /** Unknown fields from the file, round-tripped unchanged. */
  extra: Record<string, unknown>;
}

export interface TreeNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  label?: string;
  comment?: string;
  decorators: SubItem[];
  services: SubItem[];
  childNodes: TreeNode[];
  /** Unknown fields from the file (incl. `name`), round-tripped unchanged. */
  extra: Record<string, unknown>;
}

/** Selection: a node, or a decorator/service of a node. */
export type Selection =
  { kind: 'node'; nodeId: string } | { kind: SubItemKind; nodeId: string; itemId: string };

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** Generates unique runtime ids. */
export type IdGen = () => string;

// ---------- Validation ----------

export interface ItemValidation {
  /** Type missing from the project file. */
  missingType: boolean;
  /** Names of properties whose values fail validation. */
  invalidProperties: string[];
  isValid: boolean;
}

/** Payload of the socket `prj-reload` event. */
export type ProjectReloadPayload = { content: string } | { error: string };
