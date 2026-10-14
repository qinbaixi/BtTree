import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { validateProjectFile, type ProjectIssue } from '@owlbt/shared';
import { isEditableTarget, matchesHotkey } from '../commands/useHotkeys';
import { BlackboardView } from '../components/ProjectEditor/BlackboardView';
import { CustomTypesView } from '../components/ProjectEditor/CustomTypesView';
import { ExportSettingsView } from '../components/ProjectEditor/ExportSettingsView';
import { ScenariosView } from '../components/ProjectEditor/ScenariosView';
import { ProblemsBar } from '../components/ProjectEditor/ProblemsBar';
import { ReferenceUpdateBanner } from '../components/ProjectEditor/ReferenceUpdateBanner';
import { TypeForm } from '../components/ProjectEditor/TypeForm';
import { TypeList } from '../components/ProjectEditor/TypeList';
import { TypePreview } from '../components/ProjectEditor/TypePreview';
import { PanelResizer, usePreviewWidth } from '../components/ProjectEditor/PanelResizer';
import { countIssuesByType, selectionForPath } from '../components/ProjectEditor/issues';
import { getPathLastSegment } from '../lib/mru';
import { parseTypeParam, setNavigator } from '../lib/appNavigation';
import { alertStore } from '../store/alertStore';
import {
  projectEditorStore,
  useProjectEditorStore,
  type ProjectSelection,
} from '../store/projectEditorStore';
import styles from '../components/ProjectEditor/ProjectEditor.module.css';

/**
 * Project editor (owl-bt.json). `path` is the project file or a tree inside the project; `from` is
 * the tree to return to; `type` (kind:name) selects a type when the project has loaded.
 */
export default function ProjectEditor() {
  const [searchParams] = useSearchParams();
  const path = searchParams.get('path')?.trim() ?? '';
  const from = searchParams.get('from')?.trim() || undefined;
  const typeParam = searchParams.get('type') ?? undefined;

  if (!path) {
    return (
      <div className={styles.missingPath}>
        No project path given. <Link to="/">Go to the home page</Link> and open a project.
      </div>
    );
  }
  // Keyed by path so that switching projects starts from a clean store.
  return <ProjectEditorPage key={path} path={path} from={from} typeParam={typeParam} />;
}

/** Problems sorted with errors first, then warnings, in file order. */
function sortIssues(issues: readonly ProjectIssue[]): ProjectIssue[] {
  return [...issues].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
}

interface ProjectEditorPageProps {
  path: string;
  from?: string;
  typeParam?: string;
}

function ProjectEditorPage({ path, from, typeParam }: ProjectEditorPageProps) {
  const [previewWidth, setPreviewWidth] = usePreviewWidth();
  const navigate = useNavigate();
  const draft = useProjectEditorStore((state) => state.draft);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
  const loading = useProjectEditorStore((state) => state.loading);
  const loadError = useProjectEditorStore((state) => state.loadError);
  const dirty = useProjectEditorStore((state) => state.dirty);
  const canUndo = useProjectEditorStore((state) => state.undoStack.length > 0);
  const canRedo = useProjectEditorStore((state) => state.redoStack.length > 0);
  const selection = useProjectEditorStore((state) => state.selection);
  const saving = useProjectEditorStore((state) => state.saving);
  const saveError = useProjectEditorStore((state) => state.saveError);
  const conflict = useProjectEditorStore((state) => state.conflict);
  const externalChange = useProjectEditorStore((state) => state.externalChange);
  const externalError = useProjectEditorStore((state) => state.externalError);
  const searchRef = useRef<HTMLInputElement>(null);
  const appliedType = useRef<string | undefined>(undefined);

  const issues = useMemo(() => (draft ? validateProjectFile(draft) : []), [draft]);
  const issueCounts = useMemo(
    () => (draft ? countIssuesByType(draft, issues) : new Map()),
    [draft, issues],
  );
  const sorted = useMemo(() => sortIssues(issues), [issues]);

  // Router navigation for commands (e.g. "Edit project types" from the tree editor).
  useEffect(() => {
    setNavigator(navigate);
    return () => setNavigator(undefined);
  }, [navigate]);

  // Load the project and follow its file until the page is left.
  useEffect(() => {
    const store = projectEditorStore.getState();
    alertStore.getState().clear();
    void store.load(path);
    store.connect(path);
    return () => store.disconnect();
  }, [path]);

  // Select the type named in the URL once the project is available.
  useEffect(() => {
    const type = parseTypeParam(typeParam);
    if (!type || !draft) {
      return;
    }
    const key = `${type.kind}:${type.name}`;
    if (appliedType.current === key) {
      return;
    }
    appliedType.current = key;
    projectEditorStore.getState().select({ view: 'type', ...type });
  }, [typeParam, draft]);

  // Ask before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) {
      return undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const fileName = getPathLastSegment(projectPath ?? path);
  useEffect(() => {
    document.title = `${dirty ? '*' : ''}${fileName} - project types - owl-bt`;
  }, [dirty, fileName]);

  // Hotkeys: Ctrl+S saves (also from fields), undo/redo and Ctrl+F only outside text fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = projectEditorStore.getState();
      if (store.conflict) {
        return;
      }
      if (matchesHotkey(event, 'mod+s')) {
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        void store.save();
        return;
      }
      if (matchesHotkey(event, 'mod+f')) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (matchesHotkey(event, 'mod+z')) {
        event.preventDefault();
        store.undo();
      } else if (matchesHotkey(event, 'mod+y') || matchesHotkey(event, 'mod+shift+z')) {
        event.preventDefault();
        store.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const goTo = (issue: ProjectIssue) => {
    if (!draft) {
      return;
    }
    const target = selectionForPath(draft, issue.path);
    if (target) {
      projectEditorStore.getState().select(target);
    }
  };

  const store = projectEditorStore.getState();

  const goBack = () => {
    if (
      dirty &&
      !window.confirm('You have unsaved changes to the project types. Leave without saving?')
    ) {
      return;
    }
    navigate(from !== undefined ? `/tree?${new URLSearchParams({ path: from })}` : '/');
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <ul className={styles.topBar}>
          <li>
            <button
              type="button"
              className={styles.backButton}
              title={from !== undefined ? `Back to the tree ${from}` : 'Back to the home page'}
              onClick={goBack}
            >
              <i className="fa-solid fa-arrow-left" aria-hidden="true" />
              {from !== undefined ? `Back to ${getPathLastSegment(from)}` : 'Back to Home'}
            </button>
          </li>
          <li className={styles.brand}>
            <span className={styles.brandDot} aria-hidden="true" />
            owl-bt
          </li>
          <li>
            <button
              type="button"
              className={styles.topButton}
              disabled={!dirty || saving || !draft}
              title="Save (Ctrl+S)"
              onClick={() => void store.save()}
            >
              <i className="fa-solid fa-floppy-disk" aria-hidden="true" /> Save
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.topButton}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              onClick={() => store.undo()}
            >
              <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Undo
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.topButton}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              onClick={() => store.redo()}
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Redo
            </button>
          </li>
        </ul>
        <ol className={styles.breadcrumb}>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li title={projectPath ?? path}>{fileName}</li>
          <li className={styles.active}>
            Project types
            {dirty && (
              <span className={styles.unsaved}>
                <span className={styles.dot} aria-hidden="true" />
                Unsaved
              </span>
            )}
          </li>
        </ol>
        {externalChange && (
          <div role="status" className={styles.banner}>
            <span>The project file changed on disk. Your unsaved edits are kept.</span>
            <button type="button" className={styles.button} onClick={() => void store.reload()}>
              Reload
            </button>
            <button type="button" className={styles.button} onClick={() => store.keepMine()}>
              Keep mine
            </button>
          </div>
        )}
        {externalError !== undefined && (
          <div role="alert" className={styles.bannerError}>
            The project file on disk cannot be read: {externalError}
          </div>
        )}
        <ReferenceUpdateBanner />
      </div>

      {loadError !== undefined && !draft ? (
        <div role="alert" className={styles.loadError}>
          Failed to load the project: {loadError}
        </div>
      ) : draft === undefined ? (
        <div className={styles.loading}>{loading ? 'Loading project…' : ''}</div>
      ) : (
        <div
          className={styles.main}
          style={{ '--preview-width': `${previewWidth}px` } as CSSProperties}
        >
          <TypeList searchRef={searchRef} selection={selection} issueCounts={issueCounts} />
          <section className={styles.center} aria-label="Editor">
            <CenterPanel selection={selection} />
          </section>
          {selection?.view === 'type' && (
            <PanelResizer value={previewWidth} onResize={setPreviewWidth} />
          )}
          {selection?.view === 'type' && (
            <TypePreview
              key={`${selection.kind}:${selection.name}`}
              draft={draft}
              kind={selection.kind}
              name={selection.name}
            />
          )}
        </div>
      )}

      <ProblemsBar issues={sorted} saveError={saveError} onGo={goTo} />

      {conflict && (
        <div className={styles.backdrop}>
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="conflict-title"
          >
            <h2 id="conflict-title" className={styles.heading}>
              Project file changed on disk
            </h2>
            <p>
              owl-bt.json was changed after it was loaded. Reload to discard your edits and take the
              file from disk, or overwrite the file with your edits.
            </p>
            <div className={styles.dialogButtons}>
              <button
                type="button"
                className={styles.button}
                onClick={() => store.dismissConflict()}
              >
                Cancel
              </button>
              <button type="button" className={styles.button} onClick={() => void store.reload()}>
                Reload from disk
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                onClick={() => void store.overwrite()}
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CenterPanel({ selection }: { selection?: ProjectSelection }) {
  if (selection?.view === 'type') {
    return (
      <TypeForm
        key={`${selection.kind}:${selection.name}`}
        kind={selection.kind}
        name={selection.name}
      />
    );
  }
  if (selection?.view === 'custom') {
    return <CustomTypesView selectedName={selection.name} />;
  }
  if (selection?.view === 'export') {
    return <ExportSettingsView />;
  }
  if (selection?.view === 'scenarios') {
    return <ScenariosView />;
  }
  if (selection?.view === 'blackboard') {
    return <BlackboardView selectedName={selection.name} />;
  }
  return (
    <p className={styles.muted}>Select a type on the left, or add a node, decorator or service.</p>
  );
}
