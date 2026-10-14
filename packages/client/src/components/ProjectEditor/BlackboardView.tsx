import {
  addBlackboardKey,
  BLACKBOARD_KEY_TYPE,
  BLACKBOARD_VALUE_TYPES,
  defaultForBlackboardType,
  getBlackboardKeys,
  removeBlackboardKey,
  renameBlackboardKey,
  uniqueBlackboardKeyName,
  updateBlackboardKey,
  validateBlackboardDeclarations,
  type BlackboardIssue,
  type BlackboardKeyJson,
} from '@owlbt/shared';
import { alerts } from '../../store/alertStore';
import { projectEditorStore, useProjectEditorStore } from '../../store/projectEditorStore';
import { ProjectUsages } from '../ProjectUsages/ProjectUsages';
import { runEdit } from './PropertyTable';
import { confirmLeaveProject } from './ReferenceUpdateBanner';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';
import refStyles from './References.module.css';

/** Fields of a key declaration that have their own editor; others are kept as they are. */
export const KNOWN_KEY_FIELDS: readonly string[] = ['name', 'type', 'default', 'description'];

/** Parses the default typed in the editor for a key type. Undefined for invalid input. */
export function parseKeyDefault(type: string, text: string): unknown {
  if (type === 'number') {
    const value = Number(text);
    return text.trim() !== '' && Number.isFinite(value) ? value : undefined;
  }
  if (type === 'string') {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Shows a default in a text field: strings as they are, other values as JSON. */
function formatKeyDefault(type: string, value: unknown): string {
  if (value === undefined) {
    return '';
  }
  return type === 'string' && typeof value === 'string' ? value : JSON.stringify(value);
}

/** Center column for `blackboard`: the declared blackboard keys. */
export function BlackboardView({ selectedName }: { selectedName?: string }) {
  const draft = useProjectEditorStore((state) => state.draft);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
  if (!draft) {
    return null;
  }
  const keys = getBlackboardKeys(draft);
  const issues = validateBlackboardDeclarations(draft);
  const hasKeyType = Object.hasOwn(draft.types ?? {}, BLACKBOARD_KEY_TYPE);

  const add = () =>
    runEdit('Add blackboard key', (d) => {
      addBlackboardKey(d, { name: uniqueBlackboardKeyName(d, 'Key'), type: 'string' });
    });

  return (
    <div className={styles.form}>
      <div className={styles.propertyHead}>
        <h2 className={styles.heading}>Blackboard</h2>
        <button type="button" className={styles.button} onClick={add}>
          + Key
        </button>
      </div>
      <p className={styles.muted}>
        Declare the blackboard keys your trees use. Properties of the custom type{' '}
        <code>{BLACKBOARD_KEY_TYPE}</code> suggest these keys and warn about other names. Run mode
        starts with the keys and their defaults when no scenario is picked. Renaming a key also
        renames it in property defaults and scenarios; after saving you can update the tree files.
      </p>
      {!hasKeyType && (
        <p className={refStyles.keyWarning}>
          {`The project has no custom type '${BLACKBOARD_KEY_TYPE}': add it under Custom types and use it for properties that hold key names.`}
        </p>
      )}
      {issues.some((issue) => issue.path === 'blackboard') && (
        <p className={refStyles.keyError}>blackboard must be an array of keys.</p>
      )}
      {keys.length === 0 && <p className={styles.muted}>No blackboard keys declared yet.</p>}
      {keys.map((key, index) => (
        <KeyCard
          key={index}
          entry={key}
          selected={key.name === selectedName}
          issues={issues.filter((issue) => issue.path.startsWith(`blackboard[${index}].`))}
          projectPath={projectPath}
        />
      ))}
    </div>
  );
}

interface KeyCardProps {
  entry: BlackboardKeyJson;
  selected: boolean;
  issues: BlackboardIssue[];
  projectPath?: string;
}

function KeyCard({ entry, selected, issues, projectPath }: KeyCardProps) {
  const name = entry.name;
  const type = typeof entry.type === 'string' ? entry.type : 'any';
  const unknown = Object.keys(entry).filter((key) => !KNOWN_KEY_FIELDS.includes(key));

  const patch = (label: string, value: Partial<BlackboardKeyJson>, coalesceKey?: string) =>
    runEdit(label, (d) => updateBlackboardKey(d, name, value), coalesceKey);

  const rename = (value: string) => {
    const next = value.trim();
    if (next === name) {
      return;
    }
    try {
      projectEditorStore.getState().apply(
        'Rename blackboard key',
        (d) => {
          renameBlackboardKey(d, name, next);
        },
        { view: 'blackboard', name: next },
        { renames: [{ kind: 'blackboardKey', from: name, to: next }] },
      );
    } catch (err) {
      alerts.error(err instanceof Error ? err.message : String(err));
    }
  };

  const setType = (next: string) => {
    // Keeps the default when it still fits; otherwise it is removed.
    const keep =
      entry.default === undefined ||
      next === 'any' ||
      typeof entry.default === typeof defaultForBlackboardType(next);
    patch('Set blackboard key type', { type: next, ...(keep ? {} : { default: undefined }) });
  };

  return (
    <section
      className={`${styles.section} ${refStyles.keyCard} ${selected ? refStyles.keyCardSelected : ''}`}
      aria-label={`Blackboard key ${name}`}
    >
      <div className={refStyles.keyRow}>
        <TextInput
          value={name}
          ariaLabel={`Key name ${name}`}
          className={`${styles.input} ${styles.mono}`}
          invalid={issues.some((issue) => issue.path.endsWith('.name'))}
          onCommit={rename}
        />
        <select
          className={styles.select}
          aria-label={`Type of key ${name}`}
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {BLACKBOARD_VALUE_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {!(BLACKBOARD_VALUE_TYPES as readonly string[]).includes(type) && (
            <option value={type}>{type}</option>
          )}
        </select>
        {type === 'bool' ? (
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              aria-label={`Default of key ${name}`}
              checked={entry.default === true}
              onChange={(event) =>
                patch('Set blackboard key default', { default: event.target.checked })
              }
            />
            default
          </label>
        ) : (
          <TextInput
            value={formatKeyDefault(type, entry.default)}
            ariaLabel={`Default of key ${name}`}
            placeholder={`default: ${JSON.stringify(defaultForBlackboardType(type))}`}
            className={styles.input}
            invalid={issues.some((issue) => issue.path.endsWith('.default'))}
            onCommit={(text) => {
              if (text === '') {
                patch('Clear blackboard key default', { default: undefined });
                return;
              }
              const parsed = parseKeyDefault(type, text);
              if (parsed === undefined) {
                alerts.error(`Default of '${name}' must be a number`);
                return;
              }
              patch('Set blackboard key default', { default: parsed });
            }}
          />
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          aria-label={`Delete key ${name}`}
          title="Delete key"
          onClick={() => {
            if (window.confirm(`Delete blackboard key '${name}'?`)) {
              runEdit('Delete blackboard key', (d) => {
                removeBlackboardKey(d, name);
              });
            }
          }}
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
        </button>
      </div>
      <TextInput
        live
        value={entry.description ?? ''}
        ariaLabel={`Description of key ${name}`}
        placeholder="Description (optional)"
        className={styles.input}
        onCommit={(value) =>
          patch(
            'Edit blackboard key description',
            { description: value === '' ? undefined : value },
            `bb-desc:${name}`,
          )
        }
      />
      {issues.map((issue) => (
        <p
          key={issue.path}
          role="alert"
          className={issue.severity === 'error' ? refStyles.keyError : refStyles.keyWarning}
        >
          {issue.message}
        </p>
      ))}
      {unknown.length > 0 && (
        <p className={styles.muted}>{`Other fields (kept as they are): ${unknown.join(', ')}`}</p>
      )}
      {projectPath !== undefined && name !== '' && (
        <ProjectUsages
          key={name}
          path={projectPath}
          kind="blackboardKey"
          name={name}
          beforeOpen={confirmLeaveProject}
        />
      )}
    </section>
  );
}
