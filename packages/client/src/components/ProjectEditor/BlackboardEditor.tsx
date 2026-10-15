import {
  convertValue,
  inferValueType,
  parseValueInput,
  VALUE_TYPES,
  type ValueType,
} from '../RunMode/runHelpers';
import { t } from '../../i18n';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

function uniqueKey(values: Record<string, unknown>): string {
  let key = 'Key';
  for (let i = 2; Object.hasOwn(values, key); i++) {
    key = `Key${i}`;
  }
  return key;
}

export interface BlackboardEditorProps {
  values: Record<string, unknown>;
  /** Names the list in accessible labels, e.g. `Key Ammo of <scope>`. */
  scope: string;
  /** Text of the add button. */
  addLabel: string;
  onChange(label: string, next: Array<[string, unknown]>): void;
}

/** Key / type / value rows of a blackboard object (scenario start values and expectations). */
export function BlackboardEditor({ values, scope, addLabel, onChange }: BlackboardEditorProps) {
  const entries = Object.entries(values);
  return (
    <div className={styles.kvList}>
      {entries.map(([key, value], i) => {
        const type = inferValueType(value);
        const replaceAt = (entry: [string, unknown]) =>
          entries.map((e, j) => (j === i ? entry : e));
        return (
          <div key={i} className={styles.scenarioRow}>
            <TextInput
              value={key}
              ariaLabel={t('Key {key} of {scope}', { key, scope })}
              className={`${styles.input} ${styles.mono}`}
              onCommit={(next) => {
                const trimmed = next.trim();
                if (trimmed === '' || (trimmed !== key && Object.hasOwn(values, trimmed))) {
                  return;
                }
                onChange('Rename blackboard key', replaceAt([trimmed, value]));
              }}
            />
            <select
              className={styles.select}
              aria-label={t('Type of {key} in {scope}', { key, scope })}
              value={type}
              onChange={(event) =>
                onChange(
                  'Set blackboard value type',
                  replaceAt([key, convertValue(value, event.target.value as ValueType)]),
                )
              }
            >
              {VALUE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {type === 'boolean' ? (
              <input
                type="checkbox"
                aria-label={t('Value of {key} in {scope}', { key, scope })}
                checked={value === true}
                onChange={(event) =>
                  onChange('Set blackboard value', replaceAt([key, event.target.checked]))
                }
              />
            ) : type === 'null' ? (
              <span className={styles.muted}>null</span>
            ) : (
              <TextInput
                value={String(value)}
                ariaLabel={t('Value of {key} in {scope}', { key, scope })}
                className={styles.input}
                onCommit={(text) => {
                  const parsed = parseValueInput(text, type);
                  if (parsed !== undefined) {
                    onChange('Set blackboard value', replaceAt([key, parsed]));
                  }
                }}
              />
            )}
            <button
              type="button"
              className={`${styles.iconButton} ${styles.danger}`}
              aria-label={t('Remove {key} from {scope}', { key, scope })}
              title={t('Remove key')}
              onClick={() =>
                onChange(
                  'Remove blackboard key',
                  entries.filter((_, j) => j !== i),
                )
              }
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={styles.button}
        onClick={() => onChange('Add blackboard key', [...entries, [uniqueKey(values), 0]])}
      >
        {addLabel}
      </button>
    </div>
  );
}
