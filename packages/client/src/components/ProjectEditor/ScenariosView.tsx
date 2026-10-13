import {
  addScenario,
  removeScenario,
  uniqueScenarioName,
  updateScenario,
  type ScenarioJson,
} from '@owlbt/shared';
import { useProjectEditorStore } from '../../store/projectEditorStore';
import {
  convertValue,
  inferValueType,
  parseValueInput,
  VALUE_TYPES,
  type ValueType,
} from '../RunMode/runHelpers';
import { runEdit } from './PropertyTable';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

function uniqueKey(blackboard: Record<string, unknown>): string {
  let key = 'Key';
  for (let i = 2; Object.hasOwn(blackboard, key); i++) {
    key = `Key${i}`;
  }
  return key;
}

/** Center column for `scenarios`: named start blackboards used by run mode. */
export function ScenariosView() {
  const draft = useProjectEditorStore((state) => state.draft);
  if (!draft) {
    return null;
  }
  const scenarios = draft.scenarios ?? [];

  const add = () =>
    runEdit('Add scenario', (d) => {
      addScenario(d, { name: uniqueScenarioName(d, 'New scenario'), blackboard: {} });
    });

  return (
    <div className={styles.form}>
      <div className={styles.propertyHead}>
        <h2 className={styles.heading}>Scenarios</h2>
        <button type="button" className={styles.button} onClick={add}>
          + Scenario
        </button>
      </div>
      <p className={styles.muted}>
        A scenario is a named set of start values for the blackboard. Pick one in run mode to
        simulate a tree in a specific situation, for example an enemy in sight or no ammo left.
      </p>
      {scenarios.length === 0 && <p className={styles.muted}>No scenarios yet.</p>}
      {scenarios.map((scenario, index) => (
        <ScenarioCard key={index} scenario={scenario} />
      ))}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioJson }) {
  const name = scenario.name;
  const entries = Object.entries(scenario.blackboard);

  const edit = (label: string, patch: Partial<ScenarioJson>, key?: string) =>
    runEdit(label, (d) => updateScenario(d, name, patch), key);

  const setEntries = (label: string, next: Array<[string, unknown]>, key?: string) =>
    edit(label, { blackboard: Object.fromEntries(next) }, key);

  return (
    <section className={styles.section} aria-label={`Scenario ${name}`}>
      <div className={styles.inline}>
        <TextInput
          value={name}
          ariaLabel={`Scenario name ${name}`}
          className={`${styles.input} ${styles.grow}`}
          onCommit={(value) => edit('Rename scenario', { name: value })}
        />
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          aria-label={`Delete scenario ${name}`}
          title="Delete scenario"
          onClick={() => {
            if (window.confirm(`Delete scenario '${name}'?`)) {
              runEdit('Delete scenario', (d) => {
                removeScenario(d, name);
              });
            }
          }}
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
        </button>
      </div>
      <TextInput
        live
        value={scenario.description ?? ''}
        ariaLabel={`Scenario description ${name}`}
        placeholder="Description (optional)"
        className={styles.input}
        onCommit={(value) =>
          edit(
            'Edit scenario description',
            { description: value === '' ? undefined : value },
            `scenario-desc:${name}`,
          )
        }
      />
      <div className={styles.kvList}>
        {entries.map(([key, value], i) => {
          const type = inferValueType(value);
          const replaceAt = (entry: [string, unknown]) =>
            entries.map((e, j) => (j === i ? entry : e));
          return (
            <div key={i} className={styles.scenarioRow}>
              <TextInput
                value={key}
                ariaLabel={`Key ${key} of ${name}`}
                className={`${styles.input} ${styles.mono}`}
                onCommit={(next) => {
                  const trimmed = next.trim();
                  if (
                    trimmed === '' ||
                    (trimmed !== key && Object.hasOwn(scenario.blackboard, trimmed))
                  ) {
                    return;
                  }
                  setEntries('Rename blackboard key', replaceAt([trimmed, value]));
                }}
              />
              <select
                className={styles.select}
                aria-label={`Type of ${key} in ${name}`}
                value={type}
                onChange={(event) =>
                  setEntries(
                    'Set blackboard value type',
                    replaceAt([key, convertValue(value, event.target.value as ValueType)]),
                  )
                }
              >
                {VALUE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {type === 'boolean' ? (
                <input
                  type="checkbox"
                  aria-label={`Value of ${key} in ${name}`}
                  checked={value === true}
                  onChange={(event) =>
                    setEntries('Set blackboard value', replaceAt([key, event.target.checked]))
                  }
                />
              ) : type === 'null' ? (
                <span className={styles.muted}>null</span>
              ) : (
                <TextInput
                  value={String(value)}
                  ariaLabel={`Value of ${key} in ${name}`}
                  className={styles.input}
                  onCommit={(text) => {
                    const parsed = parseValueInput(text, type);
                    if (parsed !== undefined) {
                      setEntries('Set blackboard value', replaceAt([key, parsed]));
                    }
                  }}
                />
              )}
              <button
                type="button"
                className={`${styles.iconButton} ${styles.danger}`}
                aria-label={`Remove ${key} from ${name}`}
                title="Remove key"
                onClick={() =>
                  setEntries(
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
          onClick={() =>
            setEntries('Add blackboard key', [...entries, [uniqueKey(scenario.blackboard), 0]])
          }
        >
          + Key
        </button>
      </div>
    </section>
  );
}
