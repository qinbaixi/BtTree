import { useState } from 'react';
import {
  DEFAULT_SCENARIO_MAX_TICKS,
  validateScenarioTestFields,
  type ProjectFile,
  type ScenarioExpectedResult,
  type ScenarioJson,
} from '@owlbt/shared';
import { runScenarioTests, type ScenarioTestCase, type ScenarioTestReport } from '../../lib/api';
import { BlackboardEditor } from './BlackboardEditor';
import { formatTrees, parseNumberField, parseTrees, withExpectField } from './scenarioTestEdit';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

const RESULTS: readonly ScenarioExpectedResult[] = ['success', 'failure', 'running'];

export type ScenarioPatch = Partial<ScenarioJson>;

export interface ScenarioTestFieldsProps {
  scenario: ScenarioJson;
  edit(label: string, patch: ScenarioPatch, coalesceKey?: string): void;
}

/** Test settings of one scenario: expected result, ticks and blackboard values, tick budget, trees. */
export function ScenarioTestFields({ scenario, edit }: ScenarioTestFieldsProps) {
  const name = scenario.name;
  const issues = validateScenarioTestFields(scenario);
  const issueFor = (field: string) => issues.find((issue) => issue.field === field);
  const expect =
    typeof scenario.expect === 'object' && scenario.expect !== null ? scenario.expect : undefined;
  const expectedBlackboard =
    expect && typeof expect.blackboard === 'object' && expect.blackboard !== null
      ? expect.blackboard
      : {};

  const setExpect = <K extends 'result' | 'ticks' | 'blackboard'>(
    label: string,
    field: K,
    value: NonNullable<ScenarioJson['expect']>[K] | undefined,
  ) => edit(label, { expect: withExpectField(scenario, field, value) });

  const numberField = (
    field: 'maxTicks' | 'ticks',
    label: string,
    value: unknown,
    placeholder: string,
  ) => {
    const issue = issueFor(field === 'ticks' ? 'expect.ticks' : field);
    return (
      <label className={styles.propField}>
        <span className={styles.propLabel}>{label}</span>
        <TextInput
          value={typeof value === 'number' ? String(value) : ''}
          ariaLabel={`${label} of ${name}`}
          placeholder={placeholder}
          className={styles.input}
          invalid={issue !== undefined}
          onCommit={(text) => {
            const parsed = parseNumberField(text);
            if (parsed === null) return;
            if (field === 'ticks') setExpect('Set expected ticks', 'ticks', parsed);
            else edit('Set max ticks', { maxTicks: parsed });
          }}
        />
        {issue && <span className={styles.fieldError}>{issue.message}</span>}
      </label>
    );
  };

  const resultIssue = issueFor('expect.result');
  const treesIssue = issueFor('trees');
  const blackboardIssue = issueFor('expect.blackboard') ?? issueFor('expect');

  return (
    <details className={styles.scenarioTests} open={expect !== undefined}>
      <summary className={styles.sectionTitle}>
        Test expectations{expect === undefined ? ' (none)' : ''}
      </summary>
      <p className={styles.muted}>
        Used by <code>owlbt test</code> and Run scenario tests. Without expectations the scenario
        only reports its result.
      </p>
      <div className={styles.propGrid}>
        <label className={styles.propField}>
          <span className={styles.propLabel}>Expected result</span>
          <select
            className={styles.select}
            aria-label={`Expected result of ${name}`}
            aria-invalid={resultIssue !== undefined}
            value={typeof expect?.result === 'string' ? expect.result : ''}
            onChange={(event) =>
              setExpect(
                'Set expected result',
                'result',
                event.target.value === ''
                  ? undefined
                  : (event.target.value as ScenarioExpectedResult),
              )
            }
          >
            <option value="">(any)</option>
            {RESULTS.map((result) => (
              <option key={result} value={result}>
                {result}
              </option>
            ))}
            {typeof expect?.result === 'string' && !RESULTS.includes(expect.result) && (
              <option value={expect.result}>{expect.result}</option>
            )}
          </select>
          {resultIssue && <span className={styles.fieldError}>{resultIssue.message}</span>}
        </label>
        {numberField('ticks', 'Expected ticks', expect?.ticks, 'any')}
        {numberField(
          'maxTicks',
          'Max ticks',
          scenario.maxTicks,
          String(DEFAULT_SCENARIO_MAX_TICKS),
        )}
        <label className={styles.propField}>
          <span className={styles.propLabel}>Manual actions</span>
          <select
            className={styles.select}
            aria-label={`Manual actions of ${name}`}
            value={scenario.manual === 'failure' ? 'failure' : 'success'}
            onChange={(event) =>
              edit('Set manual result', {
                manual: event.target.value === 'failure' ? 'failure' : undefined,
              })
            }
          >
            <option value="success">succeed</option>
            <option value="failure">fail</option>
          </select>
        </label>
        <label className={`${styles.propField} ${styles.propFieldWide}`}>
          <span className={styles.propLabel}>Trees (paths or globs, comma separated)</span>
          <TextInput
            value={formatTrees(scenario.trees)}
            ariaLabel={`Trees of ${name}`}
            placeholder="all trees, e.g. trees/*.json"
            className={`${styles.input} ${styles.mono}`}
            invalid={treesIssue !== undefined}
            onCommit={(text) => edit('Set scenario trees', { trees: parseTrees(text) })}
          />
          {treesIssue && <span className={styles.fieldError}>{treesIssue.message}</span>}
        </label>
      </div>
      <span className={styles.propLabel}>Expected blackboard values (null = unset or null)</span>
      <BlackboardEditor
        values={expectedBlackboard}
        scope={`${name} (expected)`}
        addLabel="+ Expected value"
        onChange={(label, next) =>
          setExpect(
            `${label} (expected)`,
            'blackboard',
            next.length === 0 ? undefined : Object.fromEntries(next),
          )
        }
      />
      {blackboardIssue && <span className={styles.fieldError}>{blackboardIssue.message}</span>}
    </details>
  );
}

const STATUS_TEXT: Record<ScenarioTestCase['status'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  ran: 'Ran',
  error: 'Error',
};

function statusClass(status: ScenarioTestCase['status']): string {
  if (status === 'pass') return styles.okText;
  if (status === 'ran') return styles.muted;
  return `${styles.small} ${styles.errorText}`;
}

export interface ScenarioTestRunnerProps {
  projectPath: string;
  draft: ProjectFile;
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: ScenarioTestReport }
  | { kind: 'error'; message: string };

/** "Run scenario tests" button and the result table. Tests the current (possibly unsaved) draft. */
export function ScenarioTestRunner({ projectPath, draft }: ScenarioTestRunnerProps) {
  const [state, setState] = useState<RunState>({ kind: 'idle' });

  const run = async () => {
    setState({ kind: 'running' });
    try {
      setState({ kind: 'done', report: await runScenarioTests(projectPath, draft) });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className={styles.section} aria-label="Scenario tests">
      <div className={styles.inline}>
        <span className={`${styles.sectionTitle} ${styles.grow}`}>Scenario tests</span>
        <button
          type="button"
          className={styles.primary}
          disabled={state.kind === 'running'}
          onClick={() => void run()}
        >
          {state.kind === 'running' ? 'Running…' : 'Run scenario tests'}
        </button>
      </div>
      {state.kind === 'idle' && (
        <p className={styles.muted}>
          Runs every tree of the project in every scenario with the simulation, like{' '}
          <code>owlbt test</code>, and checks the expectations. Unsaved edits are included.
        </p>
      )}
      {state.kind === 'error' && (
        <p className={styles.fieldError} role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'done' && <ScenarioTestResults report={state.report} />}
    </section>
  );
}

function ScenarioTestResults({ report }: { report: ScenarioTestReport }) {
  const s = report.summary;
  const parts = [`${s.passed} passed`, `${s.failed} failed`];
  if (s.errors > 0) parts.push(`${s.errors} errors`);
  if (s.ran > 0) parts.push(`${s.ran} without expectations`);
  return (
    <>
      <p
        className={report.ok ? styles.okText : `${styles.small} ${styles.errorText}`}
        role="status"
      >
        {s.total} scenario test{s.total === 1 ? '' : 's'}: {parts.join(', ')}
      </p>
      {report.warnings.map((warning) => (
        <p key={warning} className={styles.warningText}>
          {warning}
        </p>
      ))}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tree</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Result</th>
              <th>Ticks</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {report.cases.map((c) => (
              <tr key={`${c.treePath}::${c.scenario}`}>
                <td className={styles.mono}>{c.tree}</td>
                <td>{c.scenario}</td>
                <td className={statusClass(c.status)}>{STATUS_TEXT[c.status]}</td>
                <td>{c.result ?? ''}</td>
                <td>{c.ticks ?? ''}</td>
                <td>
                  {[...c.failures, ...c.errors.map((e) => `engine error: ${e}`)].map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
