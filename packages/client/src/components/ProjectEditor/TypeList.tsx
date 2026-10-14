import { useState, type CSSProperties, type Ref } from 'react';
import {
  addType,
  duplicateType,
  findType,
  findTypeReferences,
  getBases,
  getTypes,
  moveType,
  removeType,
  uniqueTypeName,
  type ItemKind,
  type ItemTypeDescJson,
  type ProjectFile,
} from '@owlbt/shared';
import { alerts } from '../../store/alertStore';
import {
  projectEditorStore,
  useProjectEditorStore,
  type ProjectSelection,
} from '../../store/projectEditorStore';
import { defaultColorFor } from './TypeForm';
import type { IssueCounts } from './issues';
import { runEdit } from './PropertyTable';
import styles from './ProjectEditor.module.css';

/** Name given to a new type of each kind. */
export const NEW_TYPE_NAME: Record<ItemKind, string> = {
  node: 'NewNode',
  decorator: 'NewDecorator',
  service: 'NewService',
};

interface Row {
  kind: ItemKind;
  name: string;
  desc: ItemTypeDescJson;
  index: number;
}

interface Group {
  id: string;
  label: string;
  kind: ItemKind;
  rows: Row[];
  total: number;
}

/** Groups the types of the file as shown in the list (composite and action nodes, decorators, services). */
export function buildGroups(draft: ProjectFile, query: string): Group[] {
  const q = query.trim().toLowerCase();
  const rowsOf = (kind: ItemKind): Row[] =>
    getTypes(draft, kind).map((desc, index) => ({ kind, name: desc.name, desc, index }));
  const nodes = rowsOf('node');
  const matches = (row: Row) => q === '' || row.name.toLowerCase().includes(q);
  const groups: Group[] = [
    {
      id: 'composite',
      label: 'Composite nodes',
      kind: 'node',
      rows: nodes.filter((row) => row.desc.isComposite === true),
      total: 0,
    },
    {
      id: 'action',
      label: 'Action nodes',
      kind: 'node',
      rows: nodes.filter((row) => row.desc.isComposite !== true),
      total: 0,
    },
    {
      id: 'decorator',
      label: 'Decorators',
      kind: 'decorator',
      rows: rowsOf('decorator'),
      total: 0,
    },
    { id: 'service', label: 'Services', kind: 'service', rows: rowsOf('service'), total: 0 },
  ];
  return groups.map((group) => ({
    ...group,
    total: group.rows.length,
    rows: group.rows.filter(matches),
  }));
}

export interface TypeListProps {
  searchRef?: Ref<HTMLInputElement>;
  selection?: ProjectSelection;
  issueCounts: Map<string, IssueCounts>;
}

/** Left column: type search, add buttons, grouped rows with per-row actions, custom types and export entries. */
export function TypeList({ searchRef, selection, issueCounts }: TypeListProps) {
  const draft = useProjectEditorStore((state) => state.draft);
  const [query, setQuery] = useState('');
  if (!draft) {
    return null;
  }
  const groups = buildGroups(draft, query);
  const customCount = Object.keys(draft.types ?? {}).length;

  const select = (next: ProjectSelection) => projectEditorStore.getState().select(next);

  const addNew = (kind: ItemKind) => {
    const current = projectEditorStore.getState().draft ?? draft;
    const name = uniqueTypeName(current, kind, NEW_TYPE_NAME[kind]);
    runEdit(`Add ${kind}`, (d) => {
      addType(d, kind, { name });
    });
    projectEditorStore.getState().select({ view: 'type', kind, name });
  };

  const removeRow = (row: Row) => {
    const refs = findTypeReferences(draft, row.kind, row.name);
    const message =
      refs.length > 0
        ? `Delete ${row.name}? It is the base of ${refs.join(', ')}, which will then have a missing base.`
        : `Delete ${row.name}?`;
    if (!window.confirm(message)) {
      return;
    }
    const current = projectEditorStore.getState().selection;
    const wasSelected =
      current?.view === 'type' && current.kind === row.kind && current.name === row.name;
    try {
      projectEditorStore.getState().apply(
        `Delete ${row.kind}`,
        (d) => {
          removeType(d, row.kind, row.name);
        },
        wasSelected ? null : undefined,
      );
    } catch (err) {
      alerts.error(err instanceof Error ? err.message : String(err));
    }
  };

  const duplicateRow = (row: Row) => {
    const current = projectEditorStore.getState().draft ?? draft;
    const copy = uniqueTypeName(current, row.kind, `${row.name} copy`);
    runEdit(`Duplicate ${row.kind}`, (d) => {
      duplicateType(d, row.kind, row.name);
    });
    select({ view: 'type', kind: row.kind, name: copy });
  };

  const moveRow = (row: Row, delta: number) => {
    const target = row.index + delta;
    runEdit(`Move ${row.kind}`, (d) => {
      moveType(d, row.kind, row.index, target);
    });
  };

  return (
    <aside className={styles.typeList} aria-label="Project types">
      <div className={styles.listTools}>
        <input
          ref={searchRef}
          type="search"
          className={styles.input}
          placeholder="Search types (Ctrl+F)"
          aria-label="Search types"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.addRow}>
          <button type="button" className={styles.button} onClick={() => addNew('node')}>
            + Node
          </button>
          <button type="button" className={styles.button} onClick={() => addNew('decorator')}>
            + Decorator
          </button>
          <button type="button" className={styles.button} onClick={() => addNew('service')}>
            + Service
          </button>
        </div>
      </div>

      <div className={styles.listScroll}>
        {groups.map((group) => (
          <section key={group.id} className={styles.group} aria-label={group.label}>
            <h3 className={styles.groupTitle}>
              {group.label}
              <span className={styles.count}>
                {group.rows.length === group.total
                  ? group.total
                  : `${group.rows.length}/${group.total}`}
              </span>
            </h3>
            <ul className={styles.rows}>
              {group.rows.map((row) => {
                const type = findType(draft, row.kind, row.name);
                const bases = type ? getBases(type) : [];
                const selected =
                  selection?.view === 'type' &&
                  selection.kind === row.kind &&
                  selection.name === row.name;
                const counts = issueCounts.get(`${row.kind}:${row.name}`);
                const color =
                  row.desc.color ?? defaultColorFor(row.kind, row.desc.isComposite === true);
                const count = getTypes(draft, row.kind).length;
                return (
                  <li
                    key={`${row.kind}:${row.name}:${row.index}`}
                    className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.rowMain}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => select({ view: 'type', kind: row.kind, name: row.name })}
                    >
                      <span
                        className={styles.badge}
                        style={{ '--item-color': color } as CSSProperties}
                        aria-hidden="true"
                      >
                        {row.desc.icon ? <i className={`fa-solid fa-${row.desc.icon}`} /> : null}
                      </span>
                      <span
                        className={`${styles.rowName} ${row.desc.isAbstract === true ? styles.abstractName : ''}`}
                      >
                        {row.name}
                      </span>
                      {row.desc.isAbstract === true && <span className={styles.tag}>abstract</span>}
                      {bases.length > 0 && (
                        <span className={styles.baseHint}>← {bases.join(', ')}</span>
                      )}
                      {counts && counts.errors > 0 && (
                        <span
                          className={styles.errorDot}
                          title={`${counts.errors} error(s)`}
                          aria-label="Has errors"
                        />
                      )}
                      {counts && counts.errors === 0 && counts.warnings > 0 && (
                        <span
                          className={styles.warnDot}
                          title={`${counts.warnings} warning(s)`}
                          aria-label="Has warnings"
                        />
                      )}
                    </button>
                    <span className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        title="Move up"
                        aria-label={`Move ${row.name} up`}
                        disabled={row.index === 0}
                        onClick={() => moveRow(row, -1)}
                      >
                        <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        title="Move down"
                        aria-label={`Move ${row.name} down`}
                        disabled={row.index >= count - 1}
                        onClick={() => moveRow(row, 1)}
                      >
                        <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        title="Duplicate"
                        aria-label={`Duplicate ${row.name}`}
                        onClick={() => duplicateRow(row)}
                      >
                        <i className="fa-regular fa-copy" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconButton} ${styles.danger}`}
                        title="Delete"
                        aria-label={`Delete ${row.name}`}
                        onClick={() => removeRow(row)}
                      >
                        <i className="fa-solid fa-trash" aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                );
              })}
              {group.rows.length === 0 && <li className={styles.muted}>No matches</li>}
            </ul>
          </section>
        ))}

        <div className={styles.group}>
          <button
            type="button"
            className={`${styles.navRow} ${selection?.view === 'custom' ? styles.rowSelected : ''}`}
            onClick={() => select({ view: 'custom' })}
          >
            <i className="fa-solid fa-puzzle-piece" aria-hidden="true" /> Custom types
            <span className={styles.count}>{customCount}</span>
          </button>
          <button
            type="button"
            className={`${styles.navRow} ${selection?.view === 'export' ? styles.rowSelected : ''}`}
            onClick={() => select({ view: 'export' })}
          >
            <i className="fa-solid fa-file-export" aria-hidden="true" /> Export settings
          </button>
          <button
            type="button"
            className={`${styles.navRow} ${selection?.view === 'scenarios' ? styles.rowSelected : ''}`}
            onClick={() => select({ view: 'scenarios' })}
          >
            <i className="fa-solid fa-flask" aria-hidden="true" /> Scenarios
            <span className={styles.count}>{draft.scenarios?.length ?? 0}</span>
          </button>
          <button
            type="button"
            className={`${styles.navRow} ${selection?.view === 'blackboard' ? styles.rowSelected : ''}`}
            onClick={() => select({ view: 'blackboard' })}
          >
            <i className="fa-solid fa-table-list" aria-hidden="true" /> Blackboard
            <span className={styles.count}>
              {Array.isArray(draft.blackboard) ? draft.blackboard.length : 0}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
