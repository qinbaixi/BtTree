import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  blackboardKeyStartValue,
  getEffectiveValue,
  getItemType,
  type CompiledProperty,
  type ScenarioJson,
} from '@owlbt/shared';
import { useProjectStore } from '../../store/projectStore';
import {
  entriesToRecord,
  runStore,
  selectIsLive,
  selectViewed,
  useRunStore,
} from '../../store/runStore';
import { useSelectedItem } from '../../store/treeStore';
import {
  convertValue,
  inferValueType,
  parseValueInput,
  VALUE_TYPES,
  type ValueType,
} from './runHelpers';
import styles from './RunMode.module.css';
import { t } from '../../i18n';

/** Left panel of run mode: scenario, blackboard and the parameters of the selected item. */
export default function RunPanel() {
  return (
    <div className={styles.panel}>
      <ScenarioSection />
      <BlackboardSection />
      <ParametersSection />
    </div>
  );
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ScenarioSection() {
  const scenarios = useProjectStore((state) => state.scenarios);
  const selected = useRunStore((state) => state.selectedScenario);
  const blackboard = useRunStore((state) => state.blackboard);
  const [busy, setBusy] = useState(false);

  const scenario: ScenarioJson | undefined = scenarios.find((s) => s.name === selected);
  const modified =
    scenario !== undefined && !sameRecord(scenario.blackboard, entriesToRecord(blackboard));

  const save = async (): Promise<void> => {
    const suggested = selected ?? '';
    const name = window.prompt(t('Scenario name'), suggested)?.trim();
    if (!name) {
      return;
    }
    if (
      scenarios.some((s) => s.name === name) &&
      !window.confirm(t("Overwrite the blackboard of scenario '{name}'?", { name }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await runStore.getState().saveScenario(name);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (
      !selected ||
      !window.confirm(t("Delete scenario '{name}' from the project?", { name: selected }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await runStore.getState().deleteScenario(selected);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{t('Scenario')}</h3>
      <div className={styles.row}>
        <select
          aria-label={t('Scenario')}
          className={styles.grow}
          value={scenario ? scenario.name : ''}
          onChange={(event) => {
            if (event.target.value) {
              runStore.getState().loadScenario(event.target.value);
            }
          }}
        >
          <option value="">{t('(custom)')}</option>
          {scenarios.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {scenario?.description && <p className={styles.note}>{scenario.description}</p>}
      {modified && (
        <p className={styles.note}>{t('The blackboard differs from the saved scenario.')}</p>
      )}
      <div className={styles.row}>
        <button type="button" disabled={busy} onClick={() => void save()}>
          {t('Save as scenario…')}
        </button>
        <button type="button" disabled={busy || !scenario} onClick={() => void remove()}>
          {t('Delete')}
        </button>
      </div>
    </section>
  );
}

interface ValueInputProps {
  value: unknown;
  type: ValueType;
  disabled?: boolean;
  label: string;
  onCommit(value: unknown): void;
}

/** Typed value editor. Text is kept locally while typing and committed when it parses. */
function ValueInput({ value, type, disabled, label, onCommit }: ValueInputProps) {
  const external = value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(external);

  useEffect(() => {
    // Take over changes made elsewhere (live values change on every tick).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync of an external value
    setText((current) => (parseValueInput(current, type) === value ? current : external));
  }, [external, type, value]);

  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.checked)}
      />
    );
  }
  if (type === 'null') {
    return <span className={styles.nullValue}>null</span>;
  }
  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseValueInput(event.target.value, type);
        if (parsed !== undefined) {
          onCommit(parsed);
        }
      }}
    />
  );
}

/** Datalist of the declared blackboard keys, suggested by the key inputs. */
const DECLARED_KEYS_LIST_ID = 'run-declared-blackboard-keys';

function BlackboardSection() {
  const entries = useRunStore((state) => state.blackboard);
  const viewed = useRunStore(selectViewed);
  const previous = useRunStore((state) => state.history[state.viewIndex - 1]);
  const live = useRunStore(selectIsLive);
  const declared = useProjectStore((state) => state.project?.blackboard) ?? [];
  const store = runStore.getState();

  const values = viewed?.blackboard ?? {};
  const entryKeys = new Set(entries.map((entry) => entry.key));
  const missingDeclared = declared.filter((key) => !entryKeys.has(key.name));
  // Keys created at runtime (by effects) that are not part of the start blackboard.
  const runtimeKeys = Object.keys(values).filter((key) => !entryKeys.has(key));

  const changed = (key: string): boolean =>
    previous !== undefined &&
    JSON.stringify(previous.blackboard[key]) !== JSON.stringify(values[key]);

  const duplicate = (key: string): boolean =>
    key.trim() !== '' && entries.filter((entry) => entry.key.trim() === key.trim()).length > 1;

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{t('Blackboard')}</h3>
      <p className={styles.note}>
        {live
          ? t('Edits apply to the live run and to the start values.')
          : t('Viewing a past tick: values are read-only.')}
      </p>
      <ul className={styles.bbList}>
        {entries.map((entry, index) => {
          const shown = Object.hasOwn(values, entry.key) ? values[entry.key] : entry.value;
          const type = inferValueType(shown);
          return (
            <li
              key={index}
              className={`${styles.bbRow} ${changed(entry.key) ? styles.changed : ''}`}
              data-changed={changed(entry.key) ? 'true' : undefined}
            >
              <input
                type="text"
                className={`${styles.bbKey} ${duplicate(entry.key) ? styles.invalid : ''}`}
                aria-label={t('Key {key}', { key: entry.key })}
                list={declared.length > 0 ? DECLARED_KEYS_LIST_ID : undefined}
                value={entry.key}
                disabled={!live}
                title={duplicate(entry.key) ? t('Duplicate key') : undefined}
                onChange={(event) =>
                  store.updateBlackboardEntry(index, { key: event.target.value })
                }
              />
              <select
                aria-label={t('Type of {key}', { key: entry.key })}
                value={type}
                disabled={!live}
                onChange={(event) =>
                  store.setBlackboardValue(
                    entry.key,
                    convertValue(shown, event.target.value as ValueType),
                  )
                }
              >
                {VALUE_TYPES.map((valueType) => (
                  <option key={valueType} value={valueType}>
                    {valueType}
                  </option>
                ))}
              </select>
              <ValueInput
                value={shown}
                type={type}
                label={t('Value of {key}', { key: entry.key })}
                disabled={!live}
                onCommit={(value) => store.setBlackboardValue(entry.key, value)}
              />
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('Remove {key}', { key: entry.key })}
                title={t('Remove')}
                disabled={!live}
                onClick={() => store.removeBlackboardEntry(index)}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {runtimeKeys.map((key) => (
          <li
            key={`rt-${key}`}
            className={`${styles.bbRow} ${styles.runtime} ${changed(key) ? styles.changed : ''}`}
            data-changed={changed(key) ? 'true' : undefined}
          >
            <span className={styles.bbKeyStatic} title={t('Created during the run')}>
              {key}
            </span>
            <span className={styles.runtimeTag}>{t('runtime')}</span>
            <span className={styles.bbValueStatic}>{JSON.stringify(values[key])}</span>
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button type="button" disabled={!live} onClick={() => store.addBlackboardEntry()}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> {t('Add key')}
        </button>
        {missingDeclared.length > 0 && (
          <button
            type="button"
            disabled={!live}
            title={t('Add {keys} with their defaults', {
              keys: missingDeclared.map((key) => key.name).join(', '),
            })}
            onClick={() => {
              for (const key of missingDeclared) {
                store.setBlackboardValue(key.name, blackboardKeyStartValue(key));
              }
            }}
          >
            <i className="fa-solid fa-table-list" aria-hidden="true" />{' '}
            {t('Add declared keys ({count})', { count: missingDeclared.length })}
          </button>
        )}
      </div>
      {declared.length > 0 && (
        <datalist id={DECLARED_KEYS_LIST_ID}>
          {declared.map((key) => (
            <option key={key.name} value={key.name}>
              {key.description}
            </option>
          ))}
        </datalist>
      )}
    </section>
  );
}

function ParametersSection() {
  const project = useProjectStore((state) => state.project);
  const selected = useSelectedItem();
  const overrides = useRunStore((state) => state.overrides);

  const item = selected?.subItem ?? selected?.node;
  const type = useMemo(
    () =>
      project && selected && item ? getItemType(project, selected.kind, item.type) : undefined,
    [project, selected, item],
  );
  const own = item ? overrides[item.id] : undefined;
  const total = Object.keys(overrides).length;

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{t('Node parameters')}</h3>
      {!item || !type ? (
        <p className={styles.note}>
          {t('Select a node, decorator or service to override its properties.')}
        </p>
      ) : type.properties.length === 0 ? (
        <p className={styles.note}>{t('{type} has no properties.', { type: item.type })}</p>
      ) : (
        <>
          <p className={styles.note}>
            {t('Overrides apply to this run only (the tree is not changed) and restart the run.')}
          </p>
          <ul className={styles.paramList}>
            {type.properties.map((prop) => (
              <ParamRow
                key={`${item.id}-${prop.name}`}
                itemId={item.id}
                prop={prop}
                base={getEffectiveValue(prop, item.properties)}
                overridden={own !== undefined && Object.hasOwn(own, prop.name)}
                value={own?.[prop.name]}
              />
            ))}
          </ul>
        </>
      )}
      <div className={styles.row}>
        <button
          type="button"
          disabled={total === 0}
          onClick={() => runStore.getState().clearOverrides()}
        >
          {total > 0 ? t('Clear overrides ({count})', { count: total }) : t('Clear overrides')}
        </button>
      </div>
    </section>
  );
}

interface ParamRowProps {
  itemId: string;
  prop: CompiledProperty;
  base: unknown;
  overridden: boolean;
  value: unknown;
}

function ParamRow({ itemId, prop, base, overridden, value }: ParamRowProps) {
  const store = runStore.getState();
  const shown = overridden ? value : base;
  const set = (next: unknown): void => store.setOverride(itemId, prop.name, next);
  const clear = (): void => store.setOverride(itemId, prop.name, undefined);

  let input: ReactNode;
  if (prop.type === 'bool') {
    input = (
      <input
        type="checkbox"
        aria-label={t('Override {name}', { name: prop.name })}
        checked={shown === true}
        onChange={(event) => set(event.target.checked)}
      />
    );
  } else if (prop.type === 'enum') {
    input = (
      <select
        aria-label={t('Override {name}', { name: prop.name })}
        value={typeof shown === 'string' ? shown : ''}
        onChange={(event) => (event.target.value === '' ? clear() : set(event.target.value))}
      >
        <option value="" />
        {(prop.values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  } else {
    input = (
      <input
        type={prop.type === 'number' ? 'number' : 'text'}
        aria-label={t('Override {name}', { name: prop.name })}
        value={shown === undefined || shown === null ? '' : String(shown)}
        placeholder={base === undefined ? '' : String(base)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            clear();
          } else if (prop.type === 'number') {
            const num = Number(raw);
            if (Number.isFinite(num)) set(num);
          } else {
            set(raw);
          }
        }}
      />
    );
  }

  return (
    <li
      className={`${styles.paramRow} ${overridden ? styles.overridden : ''}`}
      data-overridden={overridden ? 'true' : undefined}
    >
      <span className={styles.paramName} title={prop.description}>
        {prop.name}
      </span>
      {input}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t('Clear override of {name}', { name: prop.name })}
        title={t('Clear override')}
        disabled={!overridden}
        onClick={clear}
      >
        <i className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </li>
  );
}
