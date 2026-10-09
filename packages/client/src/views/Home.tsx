import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ApiError,
  createTree,
  fetchWorkspace,
  initProject,
  pickPath,
  type PickKind,
  type Workspace,
} from '../lib/api';
import { getMruList, getPathLastSegment, removeMru, type MruItem } from '../lib/mru';
import { joinPath, isJsonPath } from '../lib/paths';
import { getStorageItem, removeStorageItem, setStorageItem } from '../lib/storage';
import { alerts } from '../store/alertStore';
import styles from './Home.module.css';

/** Folder restored when the page opens. */
export const LAST_DIR_STORAGE_KEY = 'owlbt.lastDir';

/** Editor URL for a tree path. */
export function editorUrl(treePath: string): string {
  return `/tree?${new URLSearchParams({ path: treePath }).toString()}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ListingOutcome = { workspace: Workspace } | { error: string };

/** Fetches the listing without touching component state. */
async function requestListing(dir: string): Promise<ListingOutcome> {
  try {
    return { workspace: await fetchWorkspace(dir) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function readStoredFolder(): string | null {
  return getStorageItem(LAST_DIR_STORAGE_KEY) || null;
}

interface WorkspacePanelProps {
  folder: string;
  workspace: Workspace | null;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => void;
  onClose: () => void;
  onWorkspace: (workspace: Workspace) => void;
}

function WorkspacePanel({
  folder,
  workspace,
  loading,
  loadError,
  onRefresh,
  onClose,
  onWorkspace,
}: WorkspacePanelProps) {
  const navigate = useNavigate();
  const [initializing, setInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const dir = workspace?.dir ?? folder;

  const onInit = async () => {
    setInitializing(true);
    setInitError(null);
    try {
      onWorkspace(await initProject(dir));
    } catch (err) {
      setInitError(errorMessage(err));
    } finally {
      setInitializing(false);
    }
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (name === '') {
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createTree(joinPath(dir, name));
      navigate(editorUrl(created.path));
    } catch (err) {
      setCreateError(errorMessage(err));
      setCreating(false);
    }
  };

  return (
    <section className={styles.panel} aria-label="Workspace">
      <header className={styles.panelHead}>
        <div className={styles.panelTitle}>
          <div className={styles.panelName}>{getPathLastSegment(dir) || dir}</div>
          <div className={styles.panelPath}>{dir}</div>
        </div>
        <div className={styles.panelButtons}>
          <button type="button" className={styles.button} onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            Close folder
          </button>
        </div>
      </header>

      {loadError !== null && (
        <div role="alert" className={styles.error}>
          {loadError}
        </div>
      )}

      {workspace !== null && (
        <>
          <div className={styles.project}>
            {workspace.projectPath !== undefined ? (
              <>
                <span className={styles.label}>Project</span>
                <span className={styles.projectPath}>{workspace.projectPath}</span>
              </>
            ) : (
              <div className={styles.notProject}>
                <span className={styles.warning}>This folder is not inside an owl-bt project.</span>
                <button
                  type="button"
                  className={styles.button}
                  onClick={onInit}
                  disabled={initializing}
                >
                  Initialize project here
                </button>
              </div>
            )}
          </div>
          {initError !== null && (
            <div role="alert" className={styles.error}>
              {initError}
            </div>
          )}

          <h3 className={styles.subheading}>Trees</h3>
          {workspace.trees.length === 0 ? (
            <p className={styles.muted}>No tree files found in this folder.</p>
          ) : (
            <ul className={styles.trees} aria-label="Trees in this folder">
              {workspace.trees.map((tree) => (
                <li key={tree.path}>
                  <Link to={editorUrl(tree.path)} className={styles.treeLink}>
                    <div className={styles.treeName}>{tree.relPath}</div>
                    <div className={styles.treePath}>{tree.path}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {workspace.truncated && (
            <p className={styles.muted}>Only the first 500 tree files are listed.</p>
          )}

          <form className={styles.newTree} onSubmit={onCreate}>
            <label className={styles.label} htmlFor="new-tree-name">
              New tree
            </label>
            <div className={styles.newTreeRow}>
              <input
                id="new-tree-name"
                type="text"
                className={styles.input}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="trees/my-tree.json"
                disabled={workspace.projectPath === undefined}
              />
              <button
                type="submit"
                className={styles.button}
                disabled={creating || workspace.projectPath === undefined || newName.trim() === ''}
              >
                Create
              </button>
            </div>
            {workspace.projectPath === undefined && (
              <p className={styles.muted}>Initialize a project to create trees here.</p>
            )}
            {createError !== null && (
              <div role="alert" className={styles.error}>
                {createError}
              </div>
            )}
          </form>
        </>
      )}
    </section>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [treePath, setTreePath] = useState('');
  const [items, setItems] = useState<MruItem[]>(() => getMruList());
  const [pending, setPending] = useState<PickKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The folder used last time is restored on load; its listing is requested in the effect below.
  const [folder, setFolder] = useState<string | null>(readStoredFolder);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(() => readStoredFolder() !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Incremented per request so that answers to superseded requests are ignored. */
  const requestId = useRef(0);

  /** Applies a listing answer unless a newer request has started since. */
  const applyOutcome = useCallback((id: number, outcome: ListingOutcome) => {
    if (id !== requestId.current) {
      return;
    }
    if ('workspace' in outcome) {
      setWorkspace(outcome.workspace);
      setFolder(outcome.workspace.dir);
      setStorageItem(LAST_DIR_STORAGE_KEY, outcome.workspace.dir);
      setLoadError(null);
    } else {
      setWorkspace(null);
      setLoadError(outcome.error);
    }
    setLoading(false);
  }, []);

  const loadFolder = useCallback(
    (dir: string) => {
      const id = ++requestId.current;
      setFolder(dir);
      setLoading(true);
      setLoadError(null);
      void requestListing(dir).then((outcome) => applyOutcome(id, outcome));
    },
    [applyOutcome],
  );

  useEffect(() => {
    const stored = readStoredFolder();
    if (stored === null) {
      return;
    }
    const id = ++requestId.current;
    void requestListing(stored).then((outcome) => applyOutcome(id, outcome));
  }, [applyOutcome]);

  const closeFolder = () => {
    requestId.current++;
    setFolder(null);
    setWorkspace(null);
    setLoading(false);
    setLoadError(null);
    removeStorageItem(LAST_DIR_STORAGE_KEY);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = treePath.trim();
    if (path === '') {
      return;
    }
    if (isJsonPath(path)) {
      navigate(editorUrl(path));
    } else {
      void loadFolder(path);
    }
  };

  const onPick = async (kind: PickKind) => {
    setPending(kind);
    setNotice(null);
    try {
      const result = await pickPath(kind, folder ?? undefined);
      if ('cancelled' in result) {
        return;
      }
      if (kind === 'file') {
        navigate(editorUrl(result.path));
      } else {
        loadFolder(result.path);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) {
        setNotice(`${err.message} Type the path in the box above instead.`);
      } else if (err instanceof ApiError && err.status === 409) {
        setNotice(err.message);
      } else {
        alerts.error(errorMessage(err));
      }
    } finally {
      setPending(null);
    }
  };

  const onRemove = (event: MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    setItems(removeMru(path));
  };

  const dialogsBusy = pending !== null;
  const showEmptyState = items.length === 0 && folder === null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <form className={styles.form} onSubmit={onSubmit}>
          <input
            type="text"
            className={styles.input}
            value={treePath}
            onChange={(event) => setTreePath(event.target.value)}
            placeholder="Tree file or folder path…"
            aria-label="Tree file or folder path"
          />
          <button type="submit" className={styles.open}>
            Open
          </button>
        </form>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => void onPick('folder')}
            disabled={dialogsBusy}
          >
            <i className="fa-solid fa-folder-open" aria-hidden="true" /> Open folder…
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => void onPick('file')}
            disabled={dialogsBusy}
          >
            <i className="fa-solid fa-file" aria-hidden="true" /> Open tree file…
          </button>
          {pending !== null && (
            <span role="status" className={styles.status}>
              Waiting for the file dialog…
            </span>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {notice !== null && (
          <div role="alert" className={styles.notice}>
            {notice}
          </div>
        )}

        {folder !== null && (
          <WorkspacePanel
            folder={folder}
            workspace={workspace}
            loading={loading}
            loadError={loadError}
            onRefresh={() => void loadFolder(workspace?.dir ?? folder)}
            onClose={closeFolder}
            onWorkspace={setWorkspace}
          />
        )}

        {items.length > 0 && (
          <section className={styles.section} aria-labelledby="recent-heading">
            <h2 id="recent-heading" className={styles.heading}>
              Recent
            </h2>
            <ul className={styles.mru} aria-label="Recently used trees">
              {items.map((item) => (
                <li key={item.path} className={styles.mruItem}>
                  <Link to={editorUrl(item.path)} className={styles.mruLink}>
                    <div className={styles.mruName}>{getPathLastSegment(item.path)}</div>
                    <div className={styles.mruPath}>{item.path}</div>
                  </Link>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${item.path} from the list`}
                    title="Remove from list"
                    onClick={(event) => onRemove(event, item.path)}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showEmptyState && (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>Open a behavior tree</h2>
            <div className={styles.bigActions}>
              <button
                type="button"
                className={styles.bigAction}
                onClick={() => void onPick('folder')}
                disabled={dialogsBusy}
              >
                <i className="fa-solid fa-folder-open" aria-hidden="true" />
                <span>Open folder…</span>
              </button>
              <button
                type="button"
                className={styles.bigAction}
                onClick={() => void onPick('file')}
                disabled={dialogsBusy}
              >
                <i className="fa-solid fa-file" aria-hidden="true" />
                <span>Open tree file…</span>
              </button>
            </div>
            <p className={styles.hint}>
              Pick a folder to browse its trees, or a single tree file to edit it directly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
