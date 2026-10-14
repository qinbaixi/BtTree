import { useState } from 'react';
import {
  removeCustomType,
  renameCustomType,
  setCustomType,
  type CustomTypeJson,
  type ProjectFile,
} from '@owlbt/shared';
import { t } from '../../i18n';
import { alerts } from '../../store/alertStore';
import { projectEditorStore, useProjectEditorStore } from '../../store/projectEditorStore';
import { runEdit } from './PropertyTable';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

/** Number of properties (in any kind) whose type is the custom type. */
export function countCustomTypeUses(draft: ProjectFile, name: string): number {
  let count = 0;
  for (const list of [draft.nodes, draft.decorators, draft.services]) {
    for (const desc of list ?? []) {
      for (const prop of desc.properties ?? []) {
        if (prop.type === name) {
          count++;
        }
      }
    }
  }
  return count;
}

/** Result of matching a sample value against a custom type pattern. */
export function testPattern(
  pattern: string | undefined,
  sample: string,
): 'none' | 'match' | 'no-match' | 'invalid' {
  if (pattern === undefined || sample === '') {
    return 'none';
  }
  try {
    return new RegExp(`^(?:${pattern})$`).test(sample) ? 'match' : 'no-match';
  } catch {
    return 'invalid';
  }
}

function TypeRow({
  name,
  custom,
  uses,
  selected,
  onSelect,
  onRename,
  onType,
  onPattern,
  onDelete,
}: {
  name: string;
  custom: CustomTypeJson;
  uses: number;
  selected: boolean;
  onSelect(): void;
  onRename(value: string): void;
  onType(type: 'string' | 'number'): void;
  onPattern(pattern: string): void;
  onDelete(): void;
}) {
  const [sample, setSample] = useState('');
  const result = testPattern(custom.pattern, sample);
  return (
    <tr className={selected ? styles.rowSelected : undefined} onFocus={onSelect}>
      <td>
        <TextInput
          value={name}
          ariaLabel={t('Custom type name {name}', { name })}
          className={styles.input}
          onCommit={onRename}
        />
      </td>
      <td>
        <select
          className={styles.select}
          aria-label={t('Base type of {name}', { name })}
          value={custom.type}
          onChange={(event) => onType(event.target.value as 'string' | 'number')}
        >
          <option value="string">string</option>
          <option value="number">number</option>
        </select>
      </td>
      <td>
        <TextInput
          live
          value={custom.pattern ?? ''}
          ariaLabel={t('Pattern of {name}', { name })}
          placeholder={t('regular expression')}
          className={`${styles.input} ${styles.mono}`}
          onCommit={onPattern}
        />
      </td>
      <td>
        <input
          type="text"
          className={styles.input}
          placeholder={t('Test value')}
          aria-label={t('Test value for {name}', { name })}
          value={sample}
          onChange={(event) => setSample(event.target.value)}
        />
        <span
          className={
            result === 'match'
              ? styles.okText
              : result === 'no-match'
                ? styles.warningText
                : styles.muted
          }
        >
          {result === 'none' && '—'}
          {result === 'match' && t('matches')}
          {result === 'no-match' && t('no match')}
          {result === 'invalid' && t('invalid pattern')}
        </span>
      </td>
      <td className={styles.small}>
        {uses === 0
          ? t('unused')
          : uses === 1
            ? t('1 property')
            : t('{count} properties', { count: uses })}
      </td>
      <td className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          title={t('Delete custom type')}
          aria-label={t('Delete custom type {name}', { name })}
          onClick={onDelete}
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

/** Center column for `types`: name, base type, pattern with a live match test, usages and delete. */
export function CustomTypesView({ selectedName }: { selectedName?: string }) {
  const draft = useProjectEditorStore((state) => state.draft);
  if (!draft) {
    return null;
  }
  const types = draft.types ?? {};
  const names = Object.keys(types);

  const addNew = () => {
    let candidate = 'newType';
    for (let i = 2; Object.hasOwn(types, candidate); i++) {
      candidate = `newType${i}`;
    }
    runEdit('Add custom type', (d) => {
      setCustomType(d, candidate, { type: 'string' });
    });
  };

  const rename = (oldName: string, value: string) => {
    if (value.trim() === oldName) {
      return;
    }
    try {
      let updated = 0;
      projectEditorStore.getState().apply('Rename custom type', (d) => {
        updated = renameCustomType(d, oldName, value);
      });
      if (updated > 0) {
        alerts.success(
          updated === 1
            ? t('Renamed; updated 1 property')
            : t('Renamed; updated {count} properties', { count: updated }),
        );
      }
    } catch (err) {
      alerts.error(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = (name: string) => {
    const uses = countCustomTypeUses(draft, name);
    const message =
      uses > 1
        ? t('Delete custom type {name}? {count} properties use it and will keep the name.', {
            name,
            count: uses,
          })
        : uses === 1
          ? t('Delete custom type {name}? 1 property uses it and will keep the name.', { name })
          : t('Delete custom type {name}?', { name });
    if (!window.confirm(message)) {
      return;
    }
    runEdit('Delete custom type', (d) => {
      removeCustomType(d, name);
    });
  };

  return (
    <div className={styles.form}>
      <div className={styles.propertyHead}>
        <h2 className={styles.heading}>{t('Custom types')}</h2>
        <button type="button" className={styles.button} onClick={addNew}>
          {t('+ Custom type')}
        </button>
      </div>
      <p className={styles.muted}>
        {t(
          'Custom types are reusable property types: a base type of string or number plus an optional pattern. A property whose type is a custom type takes the base type and the pattern.',
        )}
      </p>
      {names.length === 0 ? (
        <p className={styles.muted}>{t('No custom types yet.')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Base type')}</th>
                <th>{t('Pattern')}</th>
                <th>{t('Test')}</th>
                <th>{t('Used by')}</th>
                <th aria-label={t('Row actions')} />
              </tr>
            </thead>
            <tbody>
              {names.map((name) => (
                <TypeRow
                  key={name}
                  name={name}
                  custom={types[name]}
                  uses={countCustomTypeUses(draft, name)}
                  selected={selectedName === name}
                  onSelect={() => projectEditorStore.getState().select({ view: 'custom', name })}
                  onRename={(value) => rename(name, value)}
                  onType={(type) =>
                    runEdit('Set custom type base', (d) => {
                      setCustomType(d, name, { ...(d.types?.[name] ?? types[name]), type });
                    })
                  }
                  onPattern={(pattern) =>
                    runEdit(
                      'Set custom type pattern',
                      (d) => {
                        const current: CustomTypeJson = { ...(d.types?.[name] ?? types[name]) };
                        if (pattern === '') {
                          delete current.pattern;
                        } else {
                          current.pattern = pattern;
                        }
                        setCustomType(d, name, current);
                      },
                      `pattern:${name}`,
                    )
                  }
                  onDelete={() => remove(name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
