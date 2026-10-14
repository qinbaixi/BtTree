import { useState, type CSSProperties } from 'react';
import {
  canAddBase,
  DEFAULT_COLORS,
  findType,
  findTypeReferences,
  getBases,
  getTypes,
  listEffectiveProperties,
  renameType,
  setBases,
  snakeCase,
  SUBTREE_PROPERTY,
  updateType,
  type ItemKind,
  type ItemExportJson,
  type ProjectFile,
} from '@owlbt/shared';
import { alerts } from '../../store/alertStore';
import { ProjectUsages } from '../ProjectUsages/ProjectUsages';
import { projectEditorStore, useProjectEditorStore } from '../../store/projectEditorStore';
import { IconPicker } from './IconPicker';
import { unknownPlaceholders } from './issues';
import { PropertyTable, runEdit, type ProjectRecipe } from './PropertyTable';
import { SimulationSection } from './SimulationSection';
import { confirmLeaveProject } from './ReferenceUpdateBanner';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

/** Keys of a type descriptor that have their own field; any other key is shown as unknown. */
export const KNOWN_TYPE_KEYS: readonly string[] = [
  'name',
  'base',
  'isAbstract',
  'icon',
  'color',
  'description',
  'properties',
  'isComposite',
  'subtree',
  'export',
  'simulate',
];

export const KIND_LABEL: Record<ItemKind, string> = {
  node: 'Node',
  decorator: 'Decorator',
  service: 'Service',
};

/** Colors offered as presets next to the color input. */
export const PRESET_COLORS: readonly string[] = [
  '#d08038',
  '#955cc6',
  '#5cc690',
  '#5c90c6',
  '#c65c5c',
  '#c6a35c',
  '#8a8f98',
  '#e0b35a',
  '#4fb3bf',
  '#d46a9f',
];

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Color a type gets when it has none. */
export function defaultColorFor(kind: ItemKind, isComposite: boolean): string {
  if (kind === 'node') {
    return isComposite ? DEFAULT_COLORS.composite : DEFAULT_COLORS.action;
  }
  return kind === 'decorator' ? DEFAULT_COLORS.decorator : DEFAULT_COLORS.service;
}

/** Parses an export field value: JSON when it parses, otherwise the text itself. */
export function parseExportValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Shows an exported value as text (strings unquoted, everything else as JSON). */
export function formatExportValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Applies a change to the export settings of a type; empty settings are removed again. */
function editExport(
  draft: ProjectFile,
  kind: ItemKind,
  name: string,
  mutate: (exp: Record<string, unknown>) => void,
): void {
  const desc = findType(draft, kind, name);
  if (!desc) {
    return;
  }
  const exp: Record<string, unknown> = { ...(desc.export ?? {}) };
  mutate(exp);
  const fields = exp.fields as Record<string, unknown> | undefined;
  if (fields !== undefined && Object.keys(fields).length === 0) {
    delete exp.fields;
  }
  if (Object.keys(exp).length === 0) {
    delete desc.export;
  } else {
    desc.export = exp as ItemExportJson;
  }
}

export interface TypeFormProps {
  kind: ItemKind;
  name: string;
}

/** Editor of one node, decorator or service type: identity, appearance, description, properties and export. */
export function TypeForm({ kind, name }: TypeFormProps) {
  const draft = useProjectEditorStore((state) => state.draft);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [iconOpen, setIconOpen] = useState(false);

  if (!draft) {
    return null;
  }
  const desc = findType(draft, kind, name);
  if (!desc) {
    return <p className={styles.muted}>This type is no longer in the project file.</p>;
  }

  const effective = listEffectiveProperties(draft, kind, name);
  const propNames = effective.map((entry) => entry.prop.name);
  const customTypes = draft.types ?? {};
  const bases = getBases(desc);
  const baseCandidates = getTypes(draft, kind)
    .map((other) => other.name)
    .filter((other) => !bases.includes(other) && canAddBase(draft, kind, name, other));
  const references = findTypeReferences(draft, kind, name);
  const unknown = Object.keys(desc).filter((key) => !KNOWN_TYPE_KEYS.includes(key));
  const isSubtree = kind === 'node' && desc.subtree === true;
  const isComposite = kind === 'node' && desc.isComposite === true && !isSubtree;
  const color = desc.color ?? defaultColorFor(kind, isComposite);
  const placeholders = desc.description ? unknownPlaceholders(desc.description, propNames) : [];
  const exp = desc.export;
  const defaultExportType = kind === 'node' ? (isComposite ? 'composite' : 'task') : kind;

  const set = (label: string, mutate: ProjectRecipe, key?: string) => runEdit(label, mutate, key);
  const patchType = (label: string, patch: Partial<typeof desc>, key?: string) =>
    set(label, (d) => updateType(d, kind, name, patch), key);

  const rename = (value: string) => {
    const next = value.trim();
    setNameError(undefined);
    if (next === name) {
      return;
    }
    if (next === '') {
      setNameError('Name is required');
      return;
    }
    if (findType(draft, kind, next)) {
      setNameError(`'${next}' is already used by another ${KIND_LABEL[kind].toLowerCase()}`);
      return;
    }
    let updated = 0;
    const changed = projectEditorStore.getState().apply(
      'Rename type',
      (d) => {
        updated = renameType(d, kind, name, next);
      },
      { view: 'type', kind, name: next },
      { renames: [{ kind, from: name, to: next }] },
    );
    if (changed && updated > 0) {
      alerts.success(`Renamed; updated ${updated} base reference${updated === 1 ? '' : 's'}`);
    }
  };

  const setColor = (value: string | undefined, key?: string) =>
    patchType('Set color', { color: value }, key);

  const commitColorText = (value: string) => {
    const text = value.trim();
    if (text === '') {
      setColor(undefined);
    } else if (HEX_COLOR.test(text)) {
      setColor(text);
    } else {
      alerts.error('Color must look like #rrggbb');
    }
  };

  const hex6 = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000';

  const insertPlaceholder = (prop: string) =>
    set('Insert placeholder', (d) => {
      const target = findType(d, kind, name);
      if (target) {
        target.description = `${target.description ?? ''}{{${prop}}}`;
      }
    });

  const editExports = (
    label: string,
    mutate: (exp: Record<string, unknown>) => void,
    key?: string,
  ) => set(label, (d) => editExport(d, kind, name, mutate), key);

  return (
    <div className={styles.form}>
      <div className={styles.typeHeader}>
        <span
          className={styles.badge}
          style={{ '--item-color': color } as CSSProperties}
          aria-hidden="true"
        >
          {desc.icon ? <i className={`fa-solid fa-${desc.icon}`} /> : null}
        </span>
        <div className={styles.grow}>
          <TextInput
            key={name}
            value={name}
            ariaLabel="Type name"
            className={`${styles.nameInput} ${nameError ? styles.invalidInput : ''}`}
            onCommit={rename}
            invalid={nameError !== undefined}
          />
          {nameError && (
            <div role="alert" className={styles.fieldError}>
              {nameError}
            </div>
          )}
        </div>
        <span className={styles.kindTag}>{KIND_LABEL[kind]}</span>
        {kind === 'node' && (
          <span className={styles.kindTag}>
            {isSubtree ? 'Subtree' : isComposite ? 'Composite' : 'Action'}
          </span>
        )}
        {desc.isAbstract === true && <span className={styles.kindTag}>abstract</span>}
      </div>

      <div className={styles.optionRow}>
        {kind === 'node' && (
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={isComposite}
              disabled={isSubtree}
              onChange={(event) =>
                patchType('Set composite', { isComposite: event.target.checked })
              }
            />
            Composite (has child nodes)
          </label>
        )}
        {kind === 'node' && (
          <label
            className={styles.checkLabel}
            title={`Runs the tree file named by its ${SUBTREE_PROPERTY} property (relative to the project folder)`}
          >
            <input
              type="checkbox"
              checked={isSubtree}
              onChange={(event) => {
                const on = event.target.checked;
                set(on ? 'Make subtree reference' : 'Remove subtree reference', (d) => {
                  updateType(d, kind, name, { subtree: on ? true : undefined });
                  // A new subtree type gets the property that holds the referenced tree.
                  const target = findType(d, kind, name);
                  if (on && target && !propNames.includes(SUBTREE_PROPERTY)) {
                    target.properties = [
                      ...(target.properties ?? []),
                      { name: SUBTREE_PROPERTY, type: 'string', default: '' },
                    ];
                  }
                });
              }}
            />
            Subtree reference (runs another tree file)
          </label>
        )}
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={desc.isAbstract === true}
            onChange={(event) =>
              patchType('Set abstract', { isAbstract: event.target.checked ? true : undefined })
            }
          />
          Abstract (base only, not in the tree)
        </label>
      </div>

      <section className={styles.section} aria-label="Base types">
        <div className={styles.fieldLabel}>Base types</div>
        <ul className={styles.chipList}>
          {bases.map((base) => (
            <li
              key={base}
              className={`${styles.chip} ${Object.hasOwn(customTypes, base) || findType(draft, kind, base) ? '' : styles.missingChip}`}
            >
              <span>{base}</span>
              <button
                type="button"
                className={styles.chipButton}
                aria-label={`Remove base ${base}`}
                title="Remove base"
                onClick={() =>
                  set('Remove base', (d) =>
                    setBases(
                      d,
                      kind,
                      name,
                      bases.filter((b) => b !== base),
                    ),
                  )
                }
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          ))}
          {bases.length === 0 && <li className={styles.muted}>None</li>}
        </ul>
        <select
          className={styles.select}
          aria-label="Add base type"
          value=""
          disabled={baseCandidates.length === 0}
          onChange={(event) => {
            const base = event.target.value;
            if (base !== '') {
              set('Add base', (d) => setBases(d, kind, name, [...bases, base]));
            }
          }}
        >
          <option value="">
            {baseCandidates.length === 0 ? 'No other types can be added' : '+ Add base…'}
          </option>
          {baseCandidates.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        {references.length > 0 && <p className={styles.muted}>Base of: {references.join(', ')}</p>}
      </section>

      <section className={styles.section} aria-label="Appearance">
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Icon</span>
          <div className={styles.inline}>
            <TextInput
              live
              value={desc.icon ?? ''}
              ariaLabel="Icon name"
              placeholder="e.g. arrow-right"
              className={styles.input}
              onCommit={(value) =>
                set(
                  'Set icon',
                  (d) => updateType(d, kind, name, { icon: value === '' ? undefined : value }),
                  `icon:${kind}:${name}`,
                )
              }
            />
            <button type="button" className={styles.button} onClick={() => setIconOpen(true)}>
              Choose…
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Color</span>
          <div className={styles.inline}>
            <input
              type="color"
              aria-label="Color"
              className={styles.colorInput}
              value={hex6}
              onChange={(event) => setColor(event.target.value, `color:${kind}:${name}`)}
            />
            <TextInput
              key={`${name}:${desc.color ?? ''}`}
              value={desc.color ?? ''}
              ariaLabel="Color hex"
              placeholder={defaultColorFor(kind, isComposite)}
              className={styles.input}
              onCommit={commitColorText}
            />
            <button
              type="button"
              className={styles.button}
              disabled={desc.color === undefined}
              onClick={() => setColor(undefined)}
            >
              Default
            </button>
          </div>
          <div className={styles.swatches}>
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={styles.swatch}
                style={{ background: preset }}
                aria-label={`Color ${preset}`}
                title={preset}
                onClick={() => setColor(preset)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Description">
        <div className={styles.fieldLabel}>Description</div>
        <TextInput
          live
          multiline
          value={desc.description ?? ''}
          ariaLabel="Description template"
          placeholder="Text with {{PropertyName}} placeholders"
          className={styles.textarea}
          onCommit={(value) =>
            set(
              'Edit description',
              (d) => updateType(d, kind, name, { description: value === '' ? undefined : value }),
              `description:${kind}:${name}`,
            )
          }
        />
        <div className={styles.placeholderHint}>
          {desc.description?.endsWith('{{') ? 'Pick a property to insert:' : 'Insert property:'}
          <ul className={styles.chipList}>
            {propNames.map((prop) => (
              <li key={prop}>
                <button
                  type="button"
                  className={styles.insertChip}
                  onClick={() => insertPlaceholder(prop)}
                >
                  {`{{${prop}}}`}
                </button>
              </li>
            ))}
            {propNames.length === 0 && <li className={styles.muted}>No properties yet</li>}
          </ul>
        </div>
        {placeholders.length > 0 && (
          <div role="alert" className={styles.warningText}>
            Unknown placeholder{placeholders.length > 1 ? 's' : ''}: {placeholders.join(', ')}
          </div>
        )}
      </section>

      <PropertyTable
        kind={kind}
        name={name}
        desc={desc}
        effective={effective}
        customTypes={customTypes}
      />

      <details className={styles.section}>
        <summary className={styles.sectionTitle}>
          Export (Erlang / Lua / TypeScript / C# / Go)
        </summary>
        <p className={styles.helpText}>
          Controls how this type is written by File → Export. Each exported node gets{' '}
          <code>type</code> and <code>sub_type</code> fields; leave them empty to use the defaults
          shown in grey. <em>Constant fields</em> are extra fields written as-is on every node of
          this type, for example <code>finish_once = true</code>.
        </p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Exported type</span>
          <TextInput
            value={exp?.type ?? ''}
            ariaLabel="Exported type"
            placeholder={`default: ${defaultExportType}`}
            className={styles.input}
            onCommit={(value) =>
              editExports('Set export type', (e) => {
                e.type = value === '' ? undefined : value;
              })
            }
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Exported sub_type</span>
          <TextInput
            value={exp?.subType === undefined ? '' : String(exp.subType)}
            ariaLabel="Exported sub_type"
            placeholder={`default: ${snakeCase(name)} (a number such as 27 is also allowed)`}
            className={styles.input}
            onCommit={(value) =>
              editExports('Set export sub_type', (e) => {
                const text = value.trim();
                e.subType =
                  text === '' ? undefined : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
              })
            }
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Constant fields</span>
          <ExportFieldRows
            fields={(exp?.fields as Record<string, unknown> | undefined) ?? {}}
            onChange={(label, mutate) => editExports(label, mutate)}
          />
        </div>
      </details>

      <SimulationSection kind={kind} name={name} desc={desc} isComposite={isComposite} />

      {projectPath !== undefined && desc.isAbstract !== true && (
        <section className={styles.section} aria-label="Usages">
          <div className={styles.fieldLabel}>Usages</div>
          <ProjectUsages
            key={`${kind}:${name}`}
            path={projectPath}
            kind={kind}
            name={name}
            beforeOpen={confirmLeaveProject}
          />
        </section>
      )}

      {unknown.length > 0 && (
        <section className={styles.section} aria-label="Unknown fields">
          <div className={styles.fieldLabel}>Unknown fields (kept as they are)</div>
          <p className={styles.muted}>
            {unknown.map((key) => (
              <code key={key} className={styles.unknownKey}>
                {key}
              </code>
            ))}
          </p>
        </section>
      )}

      {iconOpen && (
        <IconPicker
          current={desc.icon}
          onPick={(icon) => {
            setIconOpen(false);
            set('Set icon', (d) => updateType(d, kind, name, { icon }));
          }}
          onClose={() => setIconOpen(false)}
        />
      )}
    </div>
  );
}

interface ExportFieldRowsProps {
  fields: Record<string, unknown>;
  onChange(label: string, mutate: (exp: Record<string, unknown>) => void): void;
}

/** Key/value rows of the constant export fields. Values are parsed as JSON when they are valid JSON. */
function ExportFieldRows({ fields, onChange }: ExportFieldRowsProps) {
  const entries = Object.entries(fields);
  const withFields =
    (mutate: (next: Record<string, unknown>) => void) => (exp: Record<string, unknown>) => {
      const next: Record<string, unknown> = {
        ...((exp.fields as Record<string, unknown> | undefined) ?? {}),
      };
      mutate(next);
      exp.fields = next;
    };
  return (
    <div className={styles.kvList}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.kvRow}>
          <TextInput
            value={key}
            ariaLabel={`Field name ${key}`}
            className={styles.input}
            onCommit={(newKey) => {
              const trimmed = newKey.trim();
              if (trimmed === '' || (trimmed !== key && Object.hasOwn(fields, trimmed))) {
                alerts.error('Field names must be unique and not empty');
                return;
              }
              onChange(
                'Rename export field',
                withFields((next) => {
                  const renamed = Object.fromEntries(
                    Object.entries(next).map(([k, v]) => (k === key ? [trimmed, v] : [k, v])),
                  );
                  for (const k of Object.keys(next)) delete next[k];
                  Object.assign(next, renamed);
                }),
              );
            }}
          />
          <TextInput
            value={formatExportValue(value)}
            ariaLabel={`Field value ${key}`}
            className={styles.input}
            onCommit={(text) =>
              onChange(
                'Set export field',
                withFields((next) => {
                  next[key] = parseExportValue(text);
                }),
              )
            }
          />
          <button
            type="button"
            className={`${styles.iconButton} ${styles.danger}`}
            aria-label={`Remove field ${key}`}
            title="Remove field"
            onClick={() =>
              onChange(
                'Remove export field',
                withFields((next) => {
                  delete next[key];
                }),
              )
            }
          >
            <i className="fa-solid fa-trash" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          let candidate = 'field';
          for (let i = 2; Object.hasOwn(fields, candidate); i++) {
            candidate = `field${i}`;
          }
          onChange(
            'Add export field',
            withFields((next) => {
              next[candidate] = '';
            }),
          );
        }}
      >
        + Field
      </button>
    </div>
  );
}
