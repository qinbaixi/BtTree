import {
  validateSimulate,
  type ItemKind,
  type ItemTypeDescJson,
  type SimulateComposite,
  type SimulateDecorator,
  type SimulateJson,
  type SimulateMode,
} from '@owlbt/shared';
import { t } from '../../i18n';
import { runEdit } from './PropertyTable';
import { TextInput } from './TextInput';
import { editSimulate, formatNumberOrTemplate, parseNumberOrTemplate } from './simulation';
import styles from './ProjectEditor.module.css';

const MODES: readonly SimulateMode[] = ['manual', 'success', 'failure', 'rule'];
const COMPOSITES: readonly SimulateComposite[] = [
  'selector',
  'sequence',
  'parallel',
  'randomSelector',
];
const DECORATORS: readonly SimulateDecorator[] = [
  'invert',
  'forceSuccess',
  'forceFailure',
  'loop',
  'cooldown',
  'timeLimit',
];

const MODE_HELP: Record<SimulateMode, string> = {
  manual: t('waits until you press Succeed or Fail in run mode'),
  success: t('finishes with success'),
  failure: t('finishes with failure'),
  rule: t('finishes after the duration; success when the condition is true'),
};

export interface SimulationSectionProps {
  kind: ItemKind;
  name: string;
  desc: ItemTypeDescJson;
  isComposite: boolean;
}

/** Collapsible "Simulation" section of a type: the rules run mode uses to execute it. */
export function SimulationSection({ kind, name, desc, isComposite }: SimulationSectionProps) {
  const sim: SimulateJson = desc.simulate ?? {};
  const issues = validateSimulate(desc.simulate);
  const issueOf = (field: string) => issues.find((issue) => issue.field === field);

  const edit = (label: string, mutate: (s: SimulateJson) => void, key?: string) =>
    runEdit(label, (d) => editSimulate(d, kind, name, mutate), key);

  const isAction = kind === 'node' && !isComposite;
  const mode = sim.mode;
  const effects = sim.effects ?? [];

  const error = (field: string) => {
    const issue = issueOf(field);
    return issue ? (
      <div role="alert" className={styles.fieldError}>
        {issue.message}
      </div>
    ) : null;
  };

  const expressionField = (
    field: 'duration' | 'count' | 'ticks',
    label: string,
    placeholder: string,
  ) => (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <TextInput
        value={formatNumberOrTemplate(sim[field] as number | string | undefined)}
        ariaLabel={label}
        placeholder={placeholder}
        className={`${styles.input} ${styles.mono} ${issueOf(field) ? styles.invalidInput : ''}`}
        invalid={issueOf(field) !== undefined}
        onCommit={(value) =>
          edit(`Set ${field}`, (s) => {
            s[field] = parseNumberOrTemplate(value);
          })
        }
      />
      {error(field)}
    </div>
  );

  const conditionField = (placeholder: string) => (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{t('Condition')}</span>
      <TextInput
        value={sim.condition ?? ''}
        ariaLabel={t('Simulation condition')}
        placeholder={placeholder}
        className={`${styles.input} ${styles.mono} ${issueOf('condition') ? styles.invalidInput : ''}`}
        invalid={issueOf('condition') !== undefined}
        onCommit={(value) =>
          edit('Set condition', (s) => {
            s.condition = value.trim() === '' ? undefined : value.trim();
          })
        }
      />
      {error('condition')}
    </div>
  );

  return (
    <details className={styles.section} open={desc.simulate !== undefined}>
      <summary className={styles.sectionTitle}>{t('Simulation (run mode)')}</summary>
      <p className={styles.helpText}>
        {t(
          'Rules for the run mode simulator. One tick is one second. Numbers and conditions are expressions: blackboard keys,',
        )}{' '}
        <code>{'{{Property}}'}</code> {t('for a property of this item, numbers, strings,')}{' '}
        <code>true/false/null</code>, <code>+ - * / %</code>,{' '}
        <code>== != &lt; &lt;= &gt; &gt;=</code>, <code>&amp;&amp; || !</code>{' '}
        {t('and parentheses. Empty fields are inherited from the base types.')}
      </p>

      {kind === 'node' && isComposite && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('Composite kind')}</span>
          <select
            className={styles.select}
            aria-label={t('Composite kind')}
            value={sim.composite ?? ''}
            onChange={(event) =>
              edit('Set composite kind', (s) => {
                s.composite = (event.target.value || undefined) as SimulateComposite | undefined;
              })
            }
          >
            <option value="">{t('Infer from the type name (default: sequence)')}</option>
            {COMPOSITES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className={styles.muted}>
            {t('Parallel succeeds when all children succeed; a property named')} <code>Policy</code>{' '}
            {t('with the value')} <code>RequireOne</code>{' '}
            {t('makes it succeed when one child succeeds.')}
          </p>
        </div>
      )}

      {isAction && (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('Mode')}</span>
            <select
              className={styles.select}
              aria-label={t('Simulation mode')}
              value={mode ?? ''}
              onChange={(event) =>
                edit('Set mode', (s) => {
                  s.mode = (event.target.value || undefined) as SimulateMode | undefined;
                })
              }
            >
              <option value="">{t('Default (manual, or rule when anything below is set)')}</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m} — {MODE_HELP[m]}
                </option>
              ))}
            </select>
          </div>
          {mode !== 'manual' &&
            expressionField('duration', t('Duration (ticks)'), t('e.g. 3 or {{Duration}}'))}
          {(mode === undefined || mode === 'rule') && conditionField(t('e.g. Ammo > 0'))}
        </>
      )}

      {kind === 'decorator' && (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('Built-in behaviour')}</span>
            <select
              className={styles.select}
              aria-label={t('Decorator kind')}
              value={sim.decorator ?? ''}
              onChange={(event) =>
                edit('Set decorator kind', (s) => {
                  s.decorator = (event.target.value || undefined) as SimulateDecorator | undefined;
                })
              }
            >
              <option value="">{t('None (only the condition below)')}</option>
              {DECORATORS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          {sim.decorator === 'loop' &&
            expressionField(
              'count',
              t('Loop count (negative = forever)'),
              t('default 1, e.g. {{Count}}'),
            )}
          {(sim.decorator === 'cooldown' || sim.decorator === 'timeLimit') &&
            expressionField('ticks', t('Ticks'), t('e.g. 5 or {{Seconds}}'))}
          {conditionField(
            t('checked when the node starts (and every tick if periodic), e.g. Enemy == true'),
          )}
        </>
      )}

      {kind !== 'decorator' && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>
            {kind === 'service' ? t('Effects (every service tick)') : t('Effects (on success)')}
          </span>
          <div className={styles.kvList}>
            {effects.map((effect, index) => (
              <div key={index} className={styles.effectRow}>
                <TextInput
                  value={effect}
                  ariaLabel={t('Effect {number}', { number: index + 1 })}
                  placeholder={t('Key = expression, e.g. Ammo = Ammo - 1')}
                  className={`${styles.input} ${styles.mono} ${issueOf(`effects[${index}]`) ? styles.invalidInput : ''}`}
                  invalid={issueOf(`effects[${index}]`) !== undefined}
                  onCommit={(value) =>
                    edit('Edit effect', (s) => {
                      s.effects = (s.effects ?? []).map((e, i) => (i === index ? value.trim() : e));
                    })
                  }
                />
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  aria-label={t('Remove effect {number}', { number: index + 1 })}
                  title={t('Remove effect')}
                  onClick={() =>
                    edit('Remove effect', (s) => {
                      s.effects = (s.effects ?? []).filter((_, i) => i !== index);
                    })
                  }
                >
                  <i className="fa-solid fa-trash" aria-hidden="true" />
                </button>
                {error(`effects[${index}]`)}
              </div>
            ))}
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                edit('Add effect', (s) => {
                  s.effects = [...(s.effects ?? []), ''];
                })
              }
            >
              {t('+ Effect')}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
