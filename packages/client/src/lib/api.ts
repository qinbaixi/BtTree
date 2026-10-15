import type { RefKind, RefRename, SubtreeLibrary, TreeNodeJson, TreeUsage } from '@owlbt/shared';
import { t } from '../i18n';

/** A failed request. `message` is the server's text (or its JSON `message`) when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function responseError(response: Response): Promise<ApiError> {
  const text = (await response.text()).trim();
  let message = text;
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      // Not JSON after all; keep the text.
    }
  }
  return new ApiError(
    response.status,
    message || t('Request failed with status {status}', { status: response.status }),
  );
}

/** Reads the response; non-2xx responses throw an ApiError carrying the server's message. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw await responseError(response);
  }
  return response;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function treeUrl(resource: string, treePath: string): string {
  return `/api/${resource}?path=${encodeURIComponent(treePath)}`;
}

/** Raw text of the project file (owl-bt.json) that applies to the tree. */
export async function fetchProject(treePath: string): Promise<string> {
  const response = await request(treeUrl('project', treePath));
  return response.text();
}

export async function fetchTree(treePath: string): Promise<TreeNodeJson> {
  const response = await request(treeUrl('tree', treePath));
  return (await response.json()) as TreeNodeJson;
}

export async function saveTree(treePath: string, json: TreeNodeJson): Promise<void> {
  await request(treeUrl('tree', treePath), postJson(json));
}

export type PickKind = 'folder' | 'file';
export type PickResult = { path: string } | { cancelled: true };

/** Opens the native dialog on the machine running the server. Throws ApiError 501 when none is available. */
export async function pickPath(kind: PickKind, initialDir?: string): Promise<PickResult> {
  const response = await request('/api/dialog/pick', postJson({ kind, initialDir }));
  return (await response.json()) as PickResult;
}

export interface WorkspaceTree {
  path: string;
  relPath: string;
}

export interface Workspace {
  dir: string;
  projectPath?: string;
  projectDir?: string;
  trees: WorkspaceTree[];
  truncated: boolean;
}

export async function fetchWorkspace(dir: string): Promise<Workspace> {
  const response = await request(`/api/workspace?${new URLSearchParams({ dir })}`);
  return (await response.json()) as Workspace;
}

/** Creates owl-bt.json (and an example tree) in the folder and returns the refreshed workspace. */
export async function initProject(dir: string): Promise<Workspace> {
  const response = await request('/api/project/init', postJson({ dir }));
  return (await response.json()) as Workspace;
}

/** Creates a tree file from the template. Returns the absolute path of the new file. */
export async function createTree(path: string): Promise<{ path: string }> {
  const response = await request('/api/tree/create', postJson({ path }));
  return (await response.json()) as { path: string };
}

export type ExportFormat = 'erlang' | 'lua' | 'ts' | 'cs' | 'go';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['erlang', 'lua', 'ts', 'cs', 'go'];

export interface ExportedFile {
  format: ExportFormat;
  path: string;
}

export interface ExportTreeResult {
  treePath: string;
  files: ExportedFile[];
  warnings: string[];
  error?: string;
}

export interface ExportProjectResult {
  projectDir: string;
  truncated: boolean;
  results: Array<ExportTreeResult & { relPath: string }>;
}

/** Exports one tree. A failing tree is reported in `error` (the request itself succeeds). */
export async function exportTree(
  treePath: string,
  formats: readonly ExportFormat[],
): Promise<ExportTreeResult> {
  const response = await request('/api/export', postJson({ path: treePath, formats }));
  return (await response.json()) as ExportTreeResult;
}

/** Exports every tree of the project that contains the folder. */
export async function exportProject(
  dir: string,
  formats: readonly ExportFormat[],
): Promise<ExportProjectResult> {
  const response = await request('/api/export/batch', postJson({ dir, formats }));
  return (await response.json()) as ExportProjectResult;
}

/** owl-bt.json as the project editor loads it. `hash` identifies the text for conditional saves. */
export interface ProjectMeta {
  /** Absolute path of owl-bt.json. */
  path: string;
  hash: string;
  content: string;
}

/** Loads owl-bt.json (raw text and hash) for the project that applies to the path. */
export async function fetchProjectMeta(path: string): Promise<ProjectMeta> {
  const response = await request(`/api/project/meta?${new URLSearchParams({ path })}`);
  return (await response.json()) as ProjectMeta;
}

export interface ProjectSaveBody {
  content: unknown;
  baseHash: string;
  force?: boolean;
}

/**
 * Saves owl-bt.json. Throws ApiError 409 when the file changed since `baseHash` (unless `force`),
 * and ApiError 400 with the compile message when the content is not a valid project.
 */
export async function saveProject(path: string, body: ProjectSaveBody): Promise<{ hash: string }> {
  const response = await request(`/api/project?${new URLSearchParams({ path })}`, {
    ...postJson(body),
    method: 'PUT',
  });
  return (await response.json()) as { hash: string };
}

/** Plugin (owl-bt.js) state of the project that applies to a tree. `pluginPath` is null without a plugin. */
export interface PluginState {
  pluginPath: string | null;
  trusted?: boolean;
  /** Trusted before, but the file changed since. */
  changed?: boolean;
}

export async function fetchPluginState(treePath: string): Promise<PluginState> {
  const response = await request(`/api/plugin?${new URLSearchParams({ path: treePath })}`);
  return (await response.json()) as PluginState;
}

export interface ScenarioTestCase {
  /** Tree path relative to the project folder. */
  tree: string;
  treePath: string;
  scenario: string;
  status: 'pass' | 'fail' | 'ran' | 'error';
  expect: boolean;
  result?: 'success' | 'failure' | 'running';
  ticks?: number;
  maxTicks?: number;
  failures: string[];
  mismatches: Array<{ key: string; expected: unknown; actual?: unknown }>;
  errors: string[];
  durationMs: number;
}

export interface ScenarioTestReport {
  projectDir: string;
  projectPath: string;
  cases: ScenarioTestCase[];
  warnings: string[];
  summary: { total: number; passed: number; failed: number; ran: number; errors: number };
  ok: boolean;
}

/**
 * Runs the scenario tests of the project that contains `path` (like `owlbt test`). `project`
 * replaces owl-bt.json on disk (unsaved edits). Configuration errors throw ApiError 400.
 */
export async function runScenarioTests(
  path: string,
  project?: unknown,
): Promise<ScenarioTestReport> {
  const response = await request('/api/scenario-tests', postJson({ path, project }));
  return (await response.json()) as ScenarioTestReport;
}

/** Trusts the current content of the project's plugin. Resolves with the new state. */
export async function trustPlugin(treePath: string): Promise<PluginState> {
  const response = await request('/api/plugin/trust', postJson({ path: treePath }));
  return (await response.json()) as PluginState;
}

export interface FileUsages {
  /** Absolute path of the tree file. */
  path: string;
  relPath: string;
  usages: TreeUsage[];
}

export interface ProjectUsages {
  projectDir: string;
  truncated: boolean;
  files: FileUsages[];
  errors: Array<{ path: string; relPath: string; error: string }>;
}

/** Where a type or blackboard key is used in the tree files of the project that contains `path`. */
export async function fetchUsages(
  path: string,
  kind: RefKind,
  name: string,
): Promise<ProjectUsages> {
  const response = await request(`/api/usages?${new URLSearchParams({ path, kind, name })}`);
  return (await response.json()) as ProjectUsages;
}

export interface ChangedTree {
  path: string;
  relPath: string;
  count: number;
  skipped?: boolean;
}

export interface UpdateReferencesResult {
  projectDir: string;
  truncated: boolean;
  dryRun: boolean;
  changed: ChangedTree[];
  errors: Array<{ path: string; relPath: string; error: string }>;
}

/**
 * Rewrites the tree files of the project for renamed types and blackboard keys. With `dryRun` the
 * files are only counted; paths in `skip` are never written.
 */
export async function updateReferences(
  path: string,
  renames: readonly RefRename[],
  options: { dryRun?: boolean; skip?: readonly string[] } = {},
): Promise<UpdateReferencesResult> {
  const response = await request(
    '/api/references/rename',
    postJson({ path, renames, dryRun: options.dryRun === true, skip: options.skip ?? [] }),
  );
  return (await response.json()) as UpdateReferencesResult;
}

/** Referenced trees of a tree's subtree nodes, as POST /api/subtrees resolves them. */
export interface SubtreeResolution {
  /** Folder of owl-bt.json; references are relative to it. */
  projectDir: string;
  /** Project-relative path of the tree itself; null when it is not inside the project folder. */
  self: string | null;
  /** Loaded trees (or why they cannot be used) by reference, including nested references. */
  library: SubtreeLibrary;
}

/**
 * Loads the trees named by `refs` (project-relative paths) and the trees they reference. Without
 * `refs` the references of the tree file on disk are used.
 */
export async function resolveSubtrees(
  treePath: string,
  refs?: readonly string[],
): Promise<SubtreeResolution> {
  const response = await request('/api/subtrees', postJson({ path: treePath, refs }));
  return (await response.json()) as SubtreeResolution;
}
