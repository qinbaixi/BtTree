import { useState, type KeyboardEvent } from 'react';
import {
  addProperty,
  BASE_PROPERTY_TYPES,
  moveProperty,
  removeProperty,
  updateProperty,
  type CustomTypeJson,
  type EffectiveProperty,
  type ItemKind,
  type ItemTypeDescJson,
  type ProjectFile,
  type PropertyDescJson,
  type PropertyExportTarget,
} from '@owlbt/shared';
import { alerts } from '../../store/alertStore';
import { projectEditorStore } from '../../store/projectEditorStore';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

export type ValueType = 'string' | 'number' | 'bool' | 'enum';
export type ProjectRecipe = (draft: ProjectFile) => void;

/** Editor type of a property: base types as written, custom types by their own type (string when unknown). */
export function valueTypeOf(
  propType: string | undefined,
  customTypes: Record<string, CustomTypeJson>,
): ValueType {
  if (
    propType === 'number' ||
    propType === 'bool' ||
    propType === 'enum' ||
    propType === 'string'
  ) {
    return propType;
  }
  const custom = propType !== undefined ? customTypes[propType] : undefined;
  return custom?.type === 'number' ? 'number' : 'string';
}

/** Runs an edit as one undo step. Failures (duplicate or empty names) are reported as alerts. */
export function runEdit(label: string, recipe: ProjectRecipe, coalesceKey?: string): void {
  try {
    projectEditorStore
      .getState()
      .apply(label, recipe, undefined, coalesceKey !== undefined ? { coalesceKey } : undefined);
  } catch (err) {
    alerts.error(err instanceof Error ? err.message : String(err));
  }
}

export interface ValueInputProps {
  type: ValueType;
  values?: string[];
  value: unknown;
  /** Called with the new value; undefined when the field is cleared. */
  onChange(value: unknown): void;
  ariaLabel: string;
  placeholder?: string;
}

/** Input adapted to the property type: bool and enum selects, number or text fields. */
export function ValueInput({
  type,
  values,
  value,
  onChange,
  ariaLabel,
  placeholder,
}: ValueInputProps) {
  if (type === 'bool') {
    const selected = value === true ? 'true' : value === false ? 'false' : '';
    return (
      <select
        className={styles.select}
        aria-label={ariaLabel}
        value={selected}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : event.target.value === 'true')
        }
      >
        <option value="">{placeholder ?? '(none)'}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (type === 'enum') {
    const options = values ?? [];
    const current = typeof value === 'string' ? value : '';
    return (
      <select
        className={styles.select}
        aria-label={ariaLabel}
        value={current}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">{placeholder ?? '(none)'}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {current !== '' && !options.includes(current) && (
          <option value={current}>{current} (not in values)</option>
        )}
      </select>
    );
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        className={styles.input}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const text = event.target.value;
          onChange(text === '' ? undefined : Number(text));
        }}
      />
    );
  }
  return (
    <input
      type="text"
      className={styles.input}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

/** Edits the values of an enum property: add, remove and reorder. */
export function ValuesEditor({
  values,
  onChange,
  ariaLabel,
}: {
  values: string[];
  onChange(values: string[]): void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const next = draft.trim();
    if (next === '' || values.includes(next)) {
      return;
    }
    onChange([...values, next]);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= values.length) {
      return;
    }
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className={styles.valuesEditor} role="group" aria-label={ariaLabel}>
      <ul className={styles.chipList}>
        {values.map((value, index) => (
          <li key={value} className={styles.valueChip}>
            <span>{value}</span>
            <button
              type="button"
              className={styles.chipButton}
              title="Move left"
              aria-label={`Move ${value} left`}
              onClick={() => move(index, -1)}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.chipButton}
              title="Move right"
              aria-label={`Move ${value} right`}
              onClick={() => move(index, 1)}
            >
              <i className="fa-solid fa-chevron-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.chipButton}
              title="Remove value"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.inline}>
        <input
          type="text"
          className={styles.input}
          placeholder="New value"
          aria-label="New enum value"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={styles.button} onClick={add}>
          Add value
        </button>
      </div>
    </div>
  );
}

export interface PropertyTableProps {
  kind: ItemKind;
  name: string;
  desc: ItemTypeDescJson;
  effective: EffectiveProperty[];
  customTypes: Record<string, CustomTypeJson>;
}

/** Table of the properties of a type: own properties are editable, inherited ones read-only. */
export function PropertyTable({ kind, name, desc, effective, customTypes }: PropertyTableProps) {
  const own = desc.properties ?? [];
  const inherited = effective.filter((entry) => entry.from !== undefined);
  const customNames = Object.keys(customTypes);

  const addNew = () => {
    const taken = effective.map((entry) => entry.prop.name);
    let candidate = 'Property';
    for (let i = 2; taken.includes(candidate); i++) {
      candidate = `Property${i}`;
    }
    runEdit('Add property', (draft) => {
      addProperty(draft, kind, name, { name: candidate, type: 'string' });
    });
  };

  return (
    <div className={styles.propertySection}>
      <div className={styles.propertyHead}>
        <span className={styles.sectionTitle}>Properties</span>
        <button type="button" className={styles.button} onClick={addNew}>
          + Property
        </button>
      </div>
      {own.length === 0 && inherited.length === 0 && (
        <p className={styles.muted}>No properties. Add one with “+ Property”.</p>
      )}
      {(own.length > 0 || inherited.length > 0) && (
        <div className={styles.propList}>
          {inherited.map((entry) => (
            <InheritedRow
              key={`inherited:${entry.prop.name}`}
              entry={entry}
              customTypes={customTypes}
            />
          ))}
          {own.map((prop, index) => (
            <OwnRow
              key={`own:${index}:${prop.name}`}
              kind={kind}
              typeName={name}
              prop={prop}
              index={index}
              count={own.length}
              customTypes={customTypes}
              customNames={customNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Short text of the constraints of a property (min/max, enum values, custom type pattern). */
export function constraintsText(
  prop: PropertyDescJson,
  customTypes: Record<string, CustomTypeJson>,
): string {
  const parts: string[] = [];
  if (prop.type === 'enum') {
    parts.push(`values: ${(prop.values ?? []).join(', ') || '—'}`);
  }
  if (typeof prop.min === 'number' || typeof prop.max === 'number') {
    parts.push(`min ${prop.min ?? '…'} / max ${prop.max ?? '…'}`);
  }
  const custom = customTypes[prop.type];
  if (custom?.pattern !== undefined) {
    parts.push(`pattern ${custom.pattern}`);
  }
  return parts.join('; ') || '—';
}

function InheritedRow({
  entry,
  customTypes,
}: {
  entry: EffectiveProperty;
  customTypes: Record<string, CustomTypeJson>;
}) {
  const { prop } = entry;
  return (
    <div className={`${styles.propCard} ${styles.propCardInherited}`}>
      <div className={styles.propCardHead}>
        <span className={styles.mono}>{prop.name}</span>
        <span className={styles.tag}>from {entry.from}</span>
        <span className={styles.propCardMeta}>
          {prop.type}
          {prop.default === undefined ? '' : ` = ${String(prop.default)}`}
        </span>
      </div>
      <div className={styles.propCardInfo}>
        <span>{constraintsText(prop, customTypes)}</span>
        {prop.description && <span>{prop.description}</span>}
        {prop.exportName && <span>export: {prop.exportName}</span>}
      </div>
    </div>
  );
}

interface OwnRowProps {
  kind: ItemKind;
  typeName: string;
  prop: PropertyDescJson;
  index: number;
  count: number;
  customTypes: Record<string, CustomTypeJson>;
  customNames: string[];
}

function OwnRow({ kind, typeName, prop, index, count, customTypes, customNames }: OwnRowProps) {
  const valueType = valueTypeOf(prop.type, customTypes);
  const typeOptions: string[] = [...BASE_PROPERTY_TYPES, ...customNames];
  const unknownType = !typeOptions.includes(prop.type);
  const field = `${kind}:${typeName}:${prop.name}`;

  const setProp = (label: string, patch: Partial<PropertyDescJson>, key?: string) =>
    runEdit(
      label,
      (draft) => {
        updateProperty(draft, kind, typeName, prop.name, patch);
      },
      key,
    );

  const rename = (value: string) => {
    const next = value.trim();
    if (next === '') {
      alerts.error('Property name is required');
      return;
    }
    if (next !== prop.name) {
      setProp('Rename property', { name: next });
    }
  };

  const changeType = (type: string) => {
    const patch: Partial<PropertyDescJson> = { type };
    if (type !== 'enum') {
      patch.values = undefined;
    } else if (!Array.isArray(prop.values)) {
      patch.values = [];
    }
    if (valueTypeOf(type, customTypes) !== 'number') {
      patch.min = undefined;
      patch.max = undefined;
    }
    setProp('Change property type', patch);
  };

  return (
    <div className={styles.propCard}>
      <div className={styles.propCardHead}>
        <TextInput
          value={prop.name}
          ariaLabel="Property name"
          className={`${styles.input} ${styles.propName}`}
          onCommit={rename}
        />
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.iconButton}
            title="Move up"
            aria-label={`Move ${prop.name} up`}
            disabled={index === 0}
            onClick={() =>
              runEdit('Move property', (draft) => {
                moveProperty(draft, kind, typeName, index, index - 1);
              })
            }
          >
            <i className="fa-solid fa-arrow-up" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            title="Move down"
            aria-label={`Move ${prop.name} down`}
            disabled={index === count - 1}
            onClick={() =>
              runEdit('Move property', (draft) => {
                moveProperty(draft, kind, typeName, index, index + 1);
              })
            }
          >
            <i className="fa-solid fa-arrow-down" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.danger}`}
            title="Delete property"
            aria-label={`Delete ${prop.name}`}
            onClick={() =>
              runEdit('Delete property', (draft) => {
                removeProperty(draft, kind, typeName, prop.name);
              })
            }
          >
            <i className="fa-solid fa-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.propGrid}>
        <label className={styles.propField}>
          <span className={styles.propLabel}>Type</span>
          <select
            className={styles.select}
            aria-label="Property type"
            value={prop.type}
            onChange={(event) => changeType(event.target.value)}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {unknownType && <option value={prop.type}>{prop.type || '(none)'} (unknown)</option>}
          </select>
        </label>
        <div className={styles.propField}>
          <span className={styles.propLabel}>Default</span>
          <ValueInput
            type={valueType}
            values={prop.values}
            value={prop.default}
            ariaLabel="Default value"
            placeholder="(none)"
            onChange={(value) => setProp('Set default', { default: value }, `default:${field}`)}
          />
        </div>
        <div className={`${styles.propField} ${styles.propFieldWide}`}>
          <span className={styles.propLabel}>Constraints</span>
          <Constraints
            prop={prop}
            valueType={valueType}
            customTypes={customTypes}
            setProp={setProp}
            field={field}
          />
        </div>
        <div className={`${styles.propField} ${styles.propFieldWide}`}>
          <span className={styles.propLabel}>Description</span>
          <TextInput
            value={prop.description ?? ''}
            ariaLabel="Property description"
            className={styles.input}
            onCommit={(value) =>
              setProp('Set property description', { description: value === '' ? undefined : value })
            }
          />
        </div>
        <div className={styles.propField}>
          <span
            className={styles.propLabel}
            title="Key used for this property in exported Erlang / Lua / TS / C# files"
          >
            Export name
          </span>
          <TextInput
            value={prop.exportName ?? ''}
            ariaLabel="Export name"
            placeholder={prop.name}
            className={styles.input}
            onCommit={(value) =>
              setProp('Set export name', { exportName: value === '' ? undefined : value })
            }
          />
        </div>
        <div className={styles.propField}>
          <span
            className={styles.propLabel}
            title="properties: inside the node's properties map; node: as a top-level field of the node"
          >
            Export to
          </span>
          <select
            className={styles.select}
            aria-label="Export target"
            value={prop.exportTo ?? 'properties'}
            onChange={(event) =>
              setProp('Set export target', {
                exportTo:
                  event.target.value === 'properties'
                    ? undefined
                    : (event.target.value as PropertyExportTarget),
              })
            }
          >
            <option value="properties">properties map</option>
            <option value="node">node top level</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function Constraints({
  prop,
  valueType,
  customTypes,
  setProp,
  field,
}: {
  prop: PropertyDescJson;
  valueType: ValueType;
  customTypes: Record<string, CustomTypeJson>;
  setProp(label: string, patch: Partial<PropertyDescJson>, key?: string): void;
  field: string;
}) {
  if (valueType === 'number') {
    const bound = (key: 'min' | 'max') => (
      <label className={styles.inline}>
        <span className={styles.small}>{key}</span>
        <input
          type="number"
          className={styles.input}
          aria-label={key === 'min' ? 'Minimum' : 'Maximum'}
          value={typeof prop[key] === 'number' ? (prop[key] as number) : ''}
          onChange={(event) => {
            const text = event.target.value;
            setProp(
              `Set ${key}`,
              { [key]: text === '' ? undefined : Number(text) },
              `${key}:${field}`,
            );
          }}
        />
      </label>
    );
    return (
      <div className={styles.constraintStack}>
        {bound('min')}
        {bound('max')}
      </div>
    );
  }
  if (prop.type === 'enum') {
    return (
      <ValuesEditor
        ariaLabel="Enum values"
        values={prop.values ?? []}
        onChange={(values) => setProp('Set enum values', { values })}
      />
    );
  }
  const custom = customTypes[prop.type];
  if (custom?.pattern !== undefined) {
    return <code className={styles.small}>{custom.pattern}</code>;
  }
  return <span className={styles.muted}>—</span>;
}
