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
  /** Erlang/Lua export name of the property (default: the property name). */
  exportName?: string;
  /** Where the exported value goes (default 'properties'). 'node' puts it at the node's top level. */
  exportTo?: PropertyExportTarget;
  [key: string]: unknown;
}

export type PropertyExportTarget = 'properties' | 'node';

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
  /** Erlang/Lua export settings. */
  export?: ItemExportJson;
  /** Run mode (simulator) rules. Inherited field by field from the bases. */
  simulate?: SimulateJson;
  [key: string]: unknown;
}

export type SimulateMode = 'success' | 'failure' | 'manual' | 'rule';
export type SimulateComposite = 'selector' | 'sequence' | 'parallel' | 'randomSelector';
export type SimulateDecorator =
  'invert' | 'forceSuccess' | 'forceFailure' | 'loop' | 'cooldown' | 'timeLimit';

/** Per-type simulation rules of run mode (`simulate` of an item type in owl-bt.json). */
export interface SimulateJson {
  /** Actions. Default: 'manual' (or 'rule' when condition / duration / effects are set). */
  mode?: SimulateMode;
  /** Ticks an action stays RUNNING before it finishes: a number or an expression such as "{{Duration}}". */
  duration?: number | string;
  /** Expression: action / decorator result = condition ? success : failure. */
  condition?: string;
  /** Blackboard assignments: on success (actions) or on every service tick (services). */
  effects?: string[];
  /** Composite nodes. Default: inferred from the type name, else sequence. */
  composite?: SimulateComposite;
  /** Built-in decorator behaviour. */
  decorator?: SimulateDecorator;
  /** Loop decorator: iterations (number or expression); negative = forever. Default 1. */
  count?: number | string;
  /** Cooldown / timeLimit decorators: ticks (number or expression). */
  ticks?: number | string;
  [key: string]: unknown;
}

/** A named set of initial blackboard values for run mode (`scenarios` of owl-bt.json). */
export interface ScenarioJson {
  name: string;
  description?: string;
  blackboard: Record<string, unknown>;
}

/** Per-type export settings (`export` of an item type in owl-bt.json). */
export interface ItemExportJson {
  /** Exported `type`. Default: composite / task / decorator / service. */
  type?: string;
  /** Exported `sub_type`. Default: the type name in snake_case. Numbers stay numbers. */
  subType?: string | number;
  /** Constant top-level fields added to every export of the type. */
  fields?: Record<string, unknown>;
}

/** Output settings of one export format. Paths are relative to the project directory. */
export interface FormatExportJson {
  /** Default: 'export/erlang', 'export/lua', 'export/ts' or 'export/cs'. */
  outDir?: string;
  /** File name template; `{name}` is the tree file name without extension. Default: '{name}'. */
  fileName?: string;
  /** C# only: namespace of the generated class. Dotted C# identifiers. Default: 'BehaviorTrees'. */
  namespace?: string;
}

export interface ProjectExportJson {
  erlang?: FormatExportJson;
  lua?: FormatExportJson;
  ts?: FormatExportJson;
  cs?: FormatExportJson;
}

export interface ProjectFile {
  types?: Record<string, CustomTypeJson>;
  nodes?: ItemTypeDescJson[];
  decorators?: ItemTypeDescJson[];
  services?: ItemTypeDescJson[];
  export?: ProjectExportJson;
  scenarios?: ScenarioJson[];
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
  /** Export name (default: the property name). */
  exportName?: string;
  /** Export target (default: 'properties'). */
  exportTo?: PropertyExportTarget;
}

export interface CompiledItemType {
  kind: ItemKind;
  name: string;
  icon?: string;
  /** Always set: explicit color or the default for the kind. */
  color: string;
  description?: string;
  /** Direct bases as written in the project file. Omitted when the type has none. */
  bases?: string[];
  /** Nodes only; false for decorators/services. */
  isComposite: boolean;
  properties: CompiledProperty[];
  /** Erlang/Lua export settings. */
  export?: ItemExportJson;
  /** Run mode rules (merged with the ones of the bases). */
  simulate?: SimulateJson;
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
