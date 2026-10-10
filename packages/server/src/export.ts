import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import {
  buildExportModel,
  createIdGen,
  nodeFromJson,
  parseAndCompileProject,
  sanitizeModuleName,
  toErlang,
  toLua,
  type ProjectFile,
  type TreeNodeJson,
} from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import { getProject } from './project';
import { loadWorkspace } from './workspace';

export const EXPORT_FORMATS = ['erlang', 'lua'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const FORMAT_DEFAULTS: Record<ExportFormat, { outDir: string; extension: string }> = {
  erlang: { outDir: 'export/erlang', extension: '.erl' },
  lua: { outDir: 'export/lua', extension: '.lua' },
};

export interface ExportedFile {
  format: ExportFormat;
  /** Absolute path of the written file. */
  path: string;
}

export interface ExportTreeResult {
  /** Absolute path of the tree file. */
  treePath: string;
  files: ExportedFile[];
  warnings: string[];
  /** Set when the tree could not be exported. Files written before the failure stay listed. */
  error?: string;
}

export interface ExportOptions {
  /** Output folder for every format (the CLI `--out` option). Relative paths resolve against the process folder. */
  outDir?: string;
}

export interface ExportProjectResult {
  projectDir: string;
  /** True when the workspace listing stopped at its tree limit. */
  truncated: boolean;
  results: Array<ExportTreeResult & { relPath: string }>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return (EXPORT_FORMATS as readonly unknown[]).includes(value);
}

/** Validates the `formats` of a request: a non-empty list of known formats, without duplicates. */
export function parseExportFormats(raw: unknown): ExportFormat[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'formats must be a non-empty array');
  }
  const formats: ExportFormat[] = [];
  for (const item of raw) {
    if (!isExportFormat(item)) {
      throw new HttpError(400, `Unknown export format: ${String(item)}`);
    }
    if (!formats.includes(item)) {
      formats.push(item);
    }
  }
  return formats;
}

/**
 * Exports one tree to the requested formats. Writes files into the configured output folders
 * (relative to the project directory). Throws HttpError 404 when there is no project or no file;
 * problems with the tree or the output are returned in `error`.
 */
export async function exportTree(
  treePath: string,
  formats: ExportFormat[],
  options: ExportOptions = {},
): Promise<ExportTreeResult> {
  const project = await getProject(treePath);
  if (!project) {
    throw new HttpError(404, 'No project found');
  }

  const result: ExportTreeResult = { treePath, files: [], warnings: [] };

  let raw: string;
  try {
    raw = await readFile(treePath, 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new HttpError(404, 'Path not found');
    }
    return { ...result, error: `Cannot read tree: ${messageOf(err)}` };
  }

  let json: TreeNodeJson;
  try {
    json = JSON.parse(raw) as TreeNodeJson;
  } catch (err) {
    return { ...result, error: `Invalid tree file: ${messageOf(err)}` };
  }

  const compiled = parseAndCompileProject(project.content);
  if (!compiled.project) {
    return { ...result, error: `Invalid project file: ${compiled.error ?? 'unknown error'}` };
  }

  let model: ReturnType<typeof buildExportModel>;
  try {
    model = buildExportModel(nodeFromJson(json, createIdGen()), compiled.project);
  } catch (err) {
    return { ...result, error: messageOf(err) };
  }
  result.warnings = model.warnings;

  const projectFile = JSON.parse(project.content) as ProjectFile;
  const sourcePath = relative(project.dir, treePath).split(sep).join('/');
  const treeName = basename(treePath).replace(/\.json$/i, '');

  for (const format of formats) {
    const defaults = FORMAT_DEFAULTS[format];
    const config = projectFile.export?.[format] ?? {};
    const outDir = resolve(project.dir, options.outDir ?? config.outDir ?? defaults.outDir);
    const fileName = (config.fileName ?? '{name}').replace(/\{name\}/g, treeName);
    const withExtension = fileName.toLowerCase().endsWith(defaults.extension)
      ? fileName
      : `${fileName}${defaults.extension}`;
    const path = resolve(outDir, withExtension);

    const content =
      format === 'erlang'
        ? toErlang(model, {
            module: sanitizeModuleName(basename(withExtension, defaults.extension)),
            sourcePath,
          })
        : toLua(model, { sourcePath });

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    } catch (err) {
      return { ...result, error: `Cannot write ${path}: ${messageOf(err)}` };
    }
    result.files.push({ format, path });
  }

  return result;
}

/**
 * Exports every tree of the project that contains `dir`. A failing tree is reported in its result
 * and does not stop the others. Throws HttpError 404 when `dir` is not inside a project.
 */
export async function exportProject(
  dir: string,
  formats: ExportFormat[],
  options: ExportOptions = {},
): Promise<ExportProjectResult> {
  const workspace = await loadWorkspace(dir);
  if (workspace.projectDir === undefined) {
    throw new HttpError(404, 'No project found');
  }

  const results: ExportProjectResult['results'] = [];
  for (const tree of workspace.trees) {
    try {
      results.push({ relPath: tree.relPath, ...(await exportTree(tree.path, formats, options)) });
    } catch (err) {
      results.push({
        relPath: tree.relPath,
        treePath: tree.path,
        files: [],
        warnings: [],
        error: messageOf(err),
      });
    }
  }
  return { projectDir: workspace.projectDir, truncated: workspace.truncated, results };
}
