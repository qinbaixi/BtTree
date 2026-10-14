import {
  addScenario,
  removeScenario,
  uniqueScenarioName,
  updateScenario,
  type ScenarioJson,
} from '@owlbt/shared';
import { useProjectEditorStore } from '../../store/projectEditorStore';
import { BlackboardEditor } from './BlackboardEditor';
import { runEdit } from './PropertyTable';
import { ScenarioTestFields, ScenarioTestRunner } from './ScenarioTests';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

/** Center column for `scenarios`: named start blackboards used by run mode. */
export function ScenariosView() {
  const draft = useProjectEditorStore((state) => state.draft);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
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
      {scenarios.length > 0 && projectPath !== undefined && (
        <ScenarioTestRunner projectPath={projectPath} draft={draft} />
      )}
      {scenarios.length === 0 && <p className={styles.muted}>No scenarios yet.</p>}
      {scenarios.map((scenario, index) => (
        <ScenarioCard key={index} scenario={scenario} />
      ))}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioJson }) {
  const name = scenario.name;

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
      <BlackboardEditor
        values={scenario.blackboard}
        scope={name}
        addLabel="+ Key"
        onChange={setEntries}
      />
      <ScenarioTestFields scenario={scenario} edit={edit} />
    </section>
  );
}
