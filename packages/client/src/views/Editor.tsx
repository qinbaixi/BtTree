import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { collectMissingTypes, formatMissingTypes, type Selection } from '@owlbt/shared';
import AlertPanel from '../components/AlertPanel/AlertPanel';
import ContextMenu, {
  getContextMenuCommands,
  type ContextMenuState,
} from '../components/ContextMenu/ContextMenu';
import { FuzzyDialogHost } from '../components/FuzzyDialog/FuzzyDialog';
import ItemPalette from '../components/ItemPalette/ItemPalette';
import PropertyPanel from '../components/PropertyPanel/PropertyPanel';
import SidePanel from '../components/SidePanel/SidePanel';
import TopMenu from '../components/TopMenu/TopMenu';
import TreeCanvas from '../components/TreeCanvas/TreeCanvas';
// Registers the core commands (side effect of the module).
import '../commands/coreCommands';
import { commandContext } from '../commands/registry';
import { useHotkeys } from '../commands/useHotkeys';
import { getPathLastSegment, registerMru } from '../lib/mru';
import { alertStore, alerts } from '../store/alertStore';
import { projectStore, useProjectStore } from '../store/projectStore';
import { treeStore, useTreeStore } from '../store/treeStore';
import styles from './Editor.module.css';

export default function Editor() {
  const [searchParams] = useSearchParams();
  const treePath = searchParams.get('path')?.trim() ?? '';

  if (!treePath) {
    return (
      <div className={styles.missingPath}>
        No tree path given. <Link to="/">Go to the home page</Link> and open a tree.
      </div>
    );
  }
  // Keyed by path so that switching trees starts from a clean canvas and fresh stores.
  return <EditorPage key={treePath} treePath={treePath} />;
}

function EditorPage({ treePath }: { treePath: string }) {
  const project = useProjectStore((state) => state.project);
  const dirty = useTreeStore((state) => state.dirty);
  const loadCount = useTreeStore((state) => state.loadCount);
  const missingAlertId = useRef<number | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);

  useHotkeys();

  // The canvas has already selected the clicked item (or cleared the selection) when this runs.
  const openContextMenu = useCallback((_selection: Selection | undefined, x: number, y: number) => {
    setContextMenu({ x, y, commands: getContextMenuCommands(commandContext) });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);

  // Load the tree and its project, and watch the project file until unmount.
  useEffect(() => {
    alertStore.getState().clear();
    registerMru(treePath);
    const projectState = projectStore.getState();
    void projectState.load(treePath);
    projectState.connect(treePath);
    void treeStore.getState().load(treePath);
    return () => {
      projectStore.getState().disconnect();
    };
  }, [treePath]);

  // Warn about types used by the tree but missing from the project (after each load and reload).
  useEffect(() => {
    const root = treeStore.getState().root;
    if (!project || !root) {
      return;
    }
    const lines = formatMissingTypes(collectMissingTypes(root, project));
    if (missingAlertId.current !== undefined) {
      alertStore.getState().dismiss(missingAlertId.current);
      missingAlertId.current = undefined;
    }
    if (lines) {
      missingAlertId.current = alerts.warning(lines.join('\n'));
    }
  }, [project, loadCount]);

  const fileName = getPathLastSegment(treePath);

  useEffect(() => {
    document.title = `${dirty ? '*' : ''}${fileName} - owl-bt`;
  }, [dirty, fileName]);

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

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <TopMenu />
        <ol className={styles.breadcrumb}>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li className={styles.active} title={treePath}>
            {fileName}
            {dirty && (
              <span className={styles.unsaved}>
                <span className={styles.dot} aria-hidden="true" />
                Unsaved
              </span>
            )}
          </li>
        </ol>
        <AlertPanel />
      </div>
      <div className={styles.main}>
        <SidePanel title="Item palette" name="item-palette" position="left">
          <ItemPalette />
        </SidePanel>
        <div className={styles.treeArea}>
          <TreeCanvas onContextMenu={openContextMenu} />
        </div>
        <SidePanel title="Item Details" name="item-details" position="right">
          <PropertyPanel />
        </SidePanel>
      </div>
      <FuzzyDialogHost />
      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </div>
  );
}
