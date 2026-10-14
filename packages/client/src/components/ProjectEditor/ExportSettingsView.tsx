import type {
  FormatExportJson,
  ProjectExportJson,
  ProjectFile,
  SubtreeExportMode,
} from '@owlbt/shared';
import { useProjectEditorStore } from '../../store/projectEditorStore';
import { runEdit } from './PropertyTable';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

type Format = 'erlang' | 'lua' | 'ts' | 'cs' | 'go';

interface FormatInfo {
  format: Format;
  label: string;
  outDir: string;
  fileName: string;
  /** Only C# has a namespace. */
  namespace?: string;
  /** Only Go has a package. */
  package?: string;
}

/** Export formats with the defaults the exporter uses when a field is empty. */
export const FORMATS: readonly FormatInfo[] = [
  { format: 'erlang', label: 'Erlang', outDir: 'export/erlang', fileName: '{name}' },
  { format: 'lua', label: 'Lua', outDir: 'export/lua', fileName: '{name}' },
  { format: 'ts', label: 'TypeScript', outDir: 'export/ts', fileName: '{name}' },
  {
    format: 'cs',
    label: 'C#',
    outDir: 'export/cs',
    fileName: '{name}',
    namespace: 'BehaviorTrees',
  },
  {
    format: 'go',
    label: 'Go',
    outDir: 'export/go',
    fileName: '{name}',
    package: 'behaviortrees',
  },
];

type Field = keyof FormatExportJson;

/** Sets or clears one field of one format. Empty formats are removed from the file. */
export function setExportField(
  draft: ProjectFile,
  format: Format,
  field: Field,
  value: string | undefined,
): void {
  const all: ProjectExportJson = draft.export ?? {};
  const current: FormatExportJson = { ...(all[format] ?? {}) };
  if (value === undefined) {
    delete current[field];
  } else {
    current[field] = value;
  }
  if (Object.keys(current).length === 0) {
    delete all[format];
  } else {
    all[format] = current;
  }
  if (Object.keys(all).length === 0) {
    delete draft.export;
  } else {
    draft.export = all;
  }
}

/** Sets `export.subtrees`; the default ('reference' or undefined) removes the field. */
export function setSubtreeExportMode(
  draft: ProjectFile,
  mode: SubtreeExportMode | undefined,
): void {
  const all: ProjectExportJson = draft.export ?? {};
  if (mode === undefined || mode === 'reference') {
    delete all.subtrees;
  } else {
    all.subtrees = mode;
  }
  if (Object.keys(all).length === 0) {
    delete draft.export;
  } else {
    draft.export = all;
  }
}

/** Center column: output folder, file name template, C# namespace and Go package per export format. */
export function ExportSettingsView() {
  const draft = useProjectEditorStore((state) => state.draft);
  if (!draft) {
    return null;
  }
  const exports = draft.export ?? {};

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>Export settings</h2>
      <p className={styles.muted}>
        Output settings of the project. Paths are relative to the project folder. Empty fields use
        the defaults shown as placeholders.
      </p>
      <section className={styles.section} aria-label="Subtree references">
        <div className={styles.sectionTitle}>Subtree references</div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Export as</span>
          <select
            className={styles.input}
            aria-label="Subtree export mode"
            value={exports.subtrees === 'inline' ? 'inline' : 'reference'}
            onChange={(event) =>
              runEdit('Set subtree export mode', (d) =>
                setSubtreeExportMode(d, event.target.value as SubtreeExportMode),
              )
            }
          >
            <option value="reference">Reference (node names the tree; the game loads it)</option>
            <option value="inline">Inline (expand the referenced tree in place)</option>
          </select>
        </div>
      </section>
      {FORMATS.map((info) => {
        const current = exports[info.format] ?? {};
        const edit = (field: Field, value: string) =>
          runEdit(`Set ${info.label} ${field}`, (d) => {
            setExportField(d, info.format, field, value.trim() === '' ? undefined : value.trim());
          });
        return (
          <section key={info.format} className={styles.section} aria-label={`${info.label} export`}>
            <div className={styles.sectionTitle}>{info.label}</div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Output folder</span>
              <TextInput
                value={current.outDir ?? ''}
                ariaLabel={`${info.label} output folder`}
                placeholder={info.outDir}
                className={styles.input}
                onCommit={(value) => edit('outDir', value)}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>File name</span>
              <TextInput
                value={current.fileName ?? ''}
                ariaLabel={`${info.label} file name`}
                placeholder={info.fileName}
                className={styles.input}
                onCommit={(value) => edit('fileName', value)}
              />
            </div>
            {info.namespace !== undefined && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Namespace</span>
                <TextInput
                  value={current.namespace ?? ''}
                  ariaLabel="C# namespace"
                  placeholder={info.namespace}
                  className={styles.input}
                  onCommit={(value) => edit('namespace', value)}
                />
              </div>
            )}
            {info.package !== undefined && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Package</span>
                <TextInput
                  value={current.package ?? ''}
                  ariaLabel="Go package"
                  placeholder={info.package}
                  className={styles.input}
                  onCommit={(value) => edit('package', value)}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
