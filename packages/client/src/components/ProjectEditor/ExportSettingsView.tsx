import type {
  FormatExportJson,
  ProjectExportJson,
  ProjectFile,
  SubtreeExportMode,
} from '@owlbt/shared';
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { fetchPluginExporters, type PluginExporterInfo } from '../../lib/api';
import { useProjectEditorStore } from '../../store/projectEditorStore';
import { runEdit } from './PropertyTable';
import { TextInput } from './TextInput';
import styles from './ProjectEditor.module.css';

/** A built-in format or the name of an exporter of owl-bt.js. */
type Format = string;

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
  const formats = all as Record<string, unknown>;
  const existing = formats[format];
  const current: FormatExportJson =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as FormatExportJson) }
      : {};
  if (value === undefined) {
    delete current[field];
  } else {
    current[field] = value;
  }
  if (Object.keys(current).length === 0) {
    delete formats[format];
  } else {
    formats[format] = current;
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

/** Plugin formats shown with the defaults of their exporter (outDir from owl-bt.js). */
export function pluginFormatInfos(exporters: readonly PluginExporterInfo[]): FormatInfo[] {
  return exporters.map((exporter) => ({
    format: exporter.format,
    label: exporter.label,
    outDir: exporter.outDir,
    fileName: '{name}',
  }));
}

/** Loads the exporters of owl-bt.js for the edited project (none while it is not trusted). */
function usePluginExporters(projectPath: string | undefined): {
  exporters: PluginExporterInfo[];
  error?: string;
} {
  const [loaded, setLoaded] = useState<{
    projectPath: string;
    exporters: PluginExporterInfo[];
    error?: string;
  }>();
  useEffect(() => {
    if (projectPath === undefined) {
      return undefined;
    }
    let current = true;
    fetchPluginExporters(projectPath).then(
      (result) => {
        if (current) {
          setLoaded({ projectPath, exporters: result.exporters, error: result.error });
        }
      },
      () => {
        // Without the list only the built-in formats are shown.
      },
    );
    return () => {
      current = false;
    };
  }, [projectPath]);
  return loaded?.projectPath === projectPath && loaded
    ? { exporters: loaded.exporters, error: loaded.error }
    : { exporters: [] };
}

/** Center column: output folder, file name template, C# namespace and Go package per export format. */
export function ExportSettingsView() {
  const draft = useProjectEditorStore((state) => state.draft);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
  const plugin = usePluginExporters(projectPath);
  if (!draft) {
    return null;
  }
  const exports = (draft.export ?? {}) as ProjectExportJson & Record<string, unknown>;
  const formatSettings = (format: Format): FormatExportJson => {
    const value = exports[format];
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as FormatExportJson)
      : {};
  };
  const formats = [...FORMATS, ...pluginFormatInfos(plugin.exporters)];

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>{t('Export settings')}</h2>
      <p className={styles.muted}>
        {t(
          'Output settings of the project. Paths are relative to the project folder. Empty fields use the defaults shown as placeholders.',
        )}
      </p>
      <section className={styles.section} aria-label={t('Subtree references')}>
        <div className={styles.sectionTitle}>{t('Subtree references')}</div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('Export as')}</span>
          <select
            className={styles.input}
            aria-label={t('Subtree export mode')}
            value={exports.subtrees === 'inline' ? 'inline' : 'reference'}
            onChange={(event) =>
              runEdit('Set subtree export mode', (d) =>
                setSubtreeExportMode(d, event.target.value as SubtreeExportMode),
              )
            }
          >
            <option value="reference">
              {t('Reference (node names the tree; the game loads it)')}
            </option>
            <option value="inline">{t('Inline (expand the referenced tree in place)')}</option>
          </select>
        </div>
      </section>
      {plugin.error !== undefined && (
        <p className={styles.muted}>
          {t('Plugin export formats are unavailable: {message}', { message: plugin.error })}
        </p>
      )}
      {formats.map((info) => {
        const current = formatSettings(info.format);
        const edit = (field: Field, value: string) =>
          runEdit(`Set ${info.label} ${field}`, (d) => {
            setExportField(d, info.format, field, value.trim() === '' ? undefined : value.trim());
          });
        return (
          <section
            key={info.format}
            className={styles.section}
            aria-label={t('{format} export', { format: info.label })}
          >
            <div className={styles.sectionTitle}>{info.label}</div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('Output folder')}</span>
              <TextInput
                value={current.outDir ?? ''}
                ariaLabel={t('{format} output folder', { format: info.label })}
                placeholder={info.outDir}
                className={styles.input}
                onCommit={(value) => edit('outDir', value)}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('File name')}</span>
              <TextInput
                value={current.fileName ?? ''}
                ariaLabel={t('{format} file name', { format: info.label })}
                placeholder={info.fileName}
                className={styles.input}
                onCommit={(value) => edit('fileName', value)}
              />
            </div>
            {info.namespace !== undefined && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t('Namespace')}</span>
                <TextInput
                  value={current.namespace ?? ''}
                  ariaLabel={t('C# namespace')}
                  placeholder={info.namespace}
                  className={styles.input}
                  onCommit={(value) => edit('namespace', value)}
                />
              </div>
            )}
            {info.package !== undefined && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t('Package')}</span>
                <TextInput
                  value={current.package ?? ''}
                  ariaLabel={t('Go package')}
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
