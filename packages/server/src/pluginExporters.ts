import type { ExportModel, ProjectFile, TreeNodeJson } from '@owlbt/shared';
import type { Plugin } from './project';

/** Built-in export formats. Plugin exporters cannot reuse these names. */
export const BUILTIN_EXPORT_FORMATS = ['erlang', 'lua', 'ts', 'cs', 'go'] as const;
export type BuiltinExportFormat = (typeof BUILTIN_EXPORT_FORMATS)[number];

/** Names a plugin exporter may use: a letter, then letters, digits, `_` or `-` (at most 32). */
export const PLUGIN_FORMAT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** Keys of `export` in owl-bt.json (or menu ids) that are not formats. */
const RESERVED_FORMATS = new Set(['subtrees', 'all']);

/** What a plugin exporter's `render` receives besides the export model. */
export interface PluginExportContext {
  /** Name of the format (the key in `exporters`). */
  format: string;
  /** The tree file as JSON (after subtree handling it is still the file content, not inlined). */
  tree: TreeNodeJson;
  /** Absolute path of the tree file. */
  treePath: string;
  /** Tree path relative to the project folder, with forward slashes. */
  sourcePath: string;
  /** Output file name without folder and extension. */
  baseName: string;
  /** Absolute path of the file that is written. */
  outPath: string;
  /** Parsed owl-bt.json. */
  project: ProjectFile;
  /** Folder of owl-bt.json. */
  projectDir: string;
  /** `export.<format>` of owl-bt.json (empty object when not set). */
  config: Record<string, unknown>;
  /** Adds a warning to the export result. */
  warn(message: string): void;
}

/** One entry of `exporters` in owl-bt.js. */
export interface PluginExporter {
  /** Name shown in the editor. Default: the format name. */
  label?: string;
  /** File extension, with or without the dot. Default: `.<format>`. */
  extension?: string;
  /** Output folder relative to the project. Default: `export/<format>`. */
  outDir?: string;
  /** Returns the file content. */
  render(model: ExportModel, ctx: PluginExportContext): unknown;
}

/** A validated plugin exporter with its defaults filled in. */
export interface ResolvedPluginExporter {
  format: string;
  label: string;
  /** With the leading dot. */
  extension: string;
  outDir: string;
  render: PluginExporter['render'];
}

/** What the editor needs to show a plugin format. */
export interface PluginExporterInfo {
  format: string;
  label: string;
  extension: string;
  outDir: string;
}

export function isBuiltinExportFormat(value: unknown): value is BuiltinExportFormat {
  return (BUILTIN_EXPORT_FORMATS as readonly unknown[]).includes(value);
}

/** True when `name` can name a plugin format (syntax only; the plugin may still not define it). */
export function isPluginFormatName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    PLUGIN_FORMAT_PATTERN.test(name) &&
    !isBuiltinExportFormat(name) &&
    !RESERVED_FORMATS.has(name)
  );
}

function normalizeExtension(format: string, value: unknown): string | undefined {
  if (value === undefined) {
    return `.${format}`;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '.') {
    return undefined;
  }
  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return /[\\/]/.test(withDot) ? undefined : withDot;
}

/**
 * Reads `exporters` of a plugin. Invalid entries are skipped with a warning, so one broken
 * exporter does not hide the others.
 */
export function collectPluginExporters(plugin: Plugin | undefined): {
  exporters: Map<string, ResolvedPluginExporter>;
  warnings: string[];
} {
  const exporters = new Map<string, ResolvedPluginExporter>();
  const warnings: string[] = [];
  const raw: unknown = plugin?.exporters;
  if (raw === undefined || raw === null) {
    return { exporters, warnings };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('owl-bt.js: exporters must be an object');
    return { exporters, warnings };
  }
  for (const [format, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPluginFormatName(format)) {
      warnings.push(
        isBuiltinExportFormat(format) || RESERVED_FORMATS.has(format)
          ? `owl-bt.js: exporter "${format}" uses a reserved name`
          : `owl-bt.js: invalid exporter name "${format}" (use letters, digits, _ and -)`,
      );
      continue;
    }
    if (typeof entry !== 'object' || entry === null) {
      warnings.push(`owl-bt.js: exporter "${format}" must be an object`);
      continue;
    }
    const exporter = entry as Partial<PluginExporter>;
    if (typeof exporter.render !== 'function') {
      warnings.push(`owl-bt.js: exporter "${format}" has no render function`);
      continue;
    }
    const extension = normalizeExtension(format, exporter.extension);
    if (extension === undefined) {
      warnings.push(`owl-bt.js: exporter "${format}" has an invalid extension`);
      continue;
    }
    const label =
      typeof exporter.label === 'string' && exporter.label.trim() !== ''
        ? exporter.label.trim()
        : format;
    const outDir =
      typeof exporter.outDir === 'string' && exporter.outDir.trim() !== ''
        ? exporter.outDir.trim()
        : `export/${format}`;
    exporters.set(format, { format, label, extension, outDir, render: exporter.render });
  }
  return { exporters, warnings };
}

export function exporterInfo(exporter: ResolvedPluginExporter): PluginExporterInfo {
  const { format, label, extension, outDir } = exporter;
  return { format, label, extension, outDir };
}
