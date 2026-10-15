import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { collectMissingTypes, formatMissingTypes, type Selection } from '@owlbt/shared';
import AlertPanel from '../components/AlertPanel/AlertPanel';
import ContextMenu, {
  getContextMenuCommands,
  type ContextMenuState,
} from '../components/ContextMenu/ContextMenu';
import { FuzzyDialogHost } from '../components/FuzzyDialog/FuzzyDialog';
import ItemPalette from '../components/ItemPalette/ItemPalette';
import PluginBanner from '../components/PluginBanner/PluginBanner';
import RunLog from '../components/RunMode/RunLog';
import RunPanel from '../components/RunMode/RunPanel';
import RunToolbar from '../components/RunMode/RunToolbar';
import PropertyPanel from '../components/PropertyPanel/PropertyPanel';
import SidePanel from '../components/SidePanel/SidePanel';
import TabBar from '../components/TabBar/TabBar';
import TopMenu from '../components/TopMenu/TopMenu';
import TreeCanvas from '../components/TreeCanvas/TreeCanvas';
import { t } from '../i18n';
// Registers the core commands (side effect of the module).
import '../commands/coreCommands';
import { openTreeDialog } from '../commands/tabCommands';
import '../commands/viewCommands';
import '../commands/subtreeCommands';
import { commandContext } from '../commands/registry';
import { useHotkeys } from '../commands/useHotkeys';
import { setNavigator } from '../lib/appNavigation';
import { getPathLastSegment, registerMru } from '../lib/mru';
import { alertStore, alerts } from '../store/alertStore';
import { projectStore, useProjectStore } from '../store/projectStore';
import { runStore, useRunStore } from '../store/runStore';
import {
  samePath,
  selectActiveTab,
  selectAnyDirty,
  tabsStore,
  useTabsStore,
} from '../store/tabsStore';
import { startSubtreeSync } from '../store/subtreeStore';
import { treeStore, useTreeStore } from '../store/treeStore';
import styles from './Editor.module.css';
import { useDirtyTabsBeacon, useSelectFromUrl } from './useTreeLinks';

function editorUrl(treePath: string): string {
  return `/tree?${new URLSearchParams({ path: treePath }).toString()}`;
}

export default function Editor() {
  const [searchParams] = useSearchParams();
  const treePath = searchParams.get('path')?.trim() ?? '';
  const navigate = useNavigate();
  const activeTab = useTabsStore(selectActiveTab);
  const live = useTabsStore((state) => state.live);
  const select = searchParams.get('select') ?? undefined;

  useDirtyTabsBeacon();

  // While the editor is shown the tree store holds the active tab (see tabsStore).
  useEffect(() => () => tabsStore.getState().detach(), []);

  // The URL path opens (or activates) its tab; without one the tabs of the last session return.
  useEffect(() => {
    const tabs = tabsStore.getState();
    tabs.init();
    if (treePath) {
      tabs.open(treePath);
    } else if (tabs.activeId !== undefined) {
      tabs.activate(tabs.activeId);
    }
  }, [treePath]);

  // The URL follows the active tab; closing the last tab returns to the home page.
  useEffect(() => {
    const state = tabsStore.getState();
    if (!state.live) {
      return;
    }
    const active = selectActiveTab(state);
    if (!active) {
      void navigate('/');
    } else if (active.path !== treePath) {
      void navigate(editorUrl(active.path), { replace: true });
    }
  }, [activeTab, treePath, navigate]);

  if (!live || !activeTab) {
    return treePath ? null : (
      <div className={styles.missingPath}>
        {t('No tree path given.')} <Link to="/">{t('Go to the home page')}</Link>{' '}
        {t('and open a tree.')}
      </div>
    );
  }
  // Keyed by tab so that switching tabs starts from a fresh canvas; the tab's state is restored.
  return (
    <EditorPage
      key={activeTab.id}
      treePath={activeTab.path}
      select={samePath(activeTab.path, treePath) ? select : undefined}
    />
  );
}

function EditorPage({ treePath, select }: { treePath: string; select?: string }) {
  const project = useProjectStore((state) => state.project);
  const dirty = useTreeStore((state) => state.dirty);
  const anyDirty = useTabsStore(selectAnyDirty);
  const loadCount = useTreeStore((state) => state.loadCount);
  const runActive = useRunStore((state) => state.active);
  const missingAlertId = useRef<number | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);

  useHotkeys();

  const navigate = useNavigate();
  // Commands (e.g. Edit project types) navigate in this tab through the router.
  useEffect(() => {
    setNavigator(navigate);
    return () => setNavigator(undefined);
  }, [navigate]);

  // The canvas has already selected the clicked item (or cleared the selection) when this runs.
  const openContextMenu = useCallback((_selection: Selection | undefined, x: number, y: number) => {
    setContextMenu({ x, y, commands: getContextMenuCommands(commandContext) });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);
  const openTree = useCallback(() => void openTreeDialog(), []);

  // Load the tree and its project, and watch the project file until unmount.
  useEffect(() => {
    alertStore.getState().clear();
    registerMru(treePath);
    const projectState = projectStore.getState();
    void projectState.load(treePath);
    projectState.connect(treePath);
    // The tree itself is loaded (or restored) by the tabs store.
    return () => {
      projectStore.getState().disconnect();
      runStore.getState().exit();
    };
  }, [treePath]);
  // After the load effect: selects the item named in the URL (links from "Find usages").
  useSelectFromUrl(select);

  // Load the trees referenced by subtree nodes and keep their problems up to date.
  useEffect(() => startSubtreeSync(treePath), [treePath]);

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
    document.title = `${anyDirty ? '*' : ''}${fileName} - owl-bt`;
  }, [anyDirty, fileName]);

  // Ask before leaving with unsaved changes (in any tab).
  useEffect(() => {
    if (!anyDirty) {
      return undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <TopMenu />
        <ol className={styles.breadcrumb}>
          <li>
            <Link to="/">{t('Home')}</Link>
          </li>
          <li className={styles.active} title={treePath}>
            {fileName}
            {dirty && (
              <span className={styles.unsaved}>
                <span className={styles.dot} aria-hidden="true" />
                {t('Unsaved')}
              </span>
            )}
          </li>
        </ol>
        <PluginBanner treePath={treePath} />
        <AlertPanel />
        {runActive && <RunToolbar />}
      </div>
      <div className={styles.main}>
        <SidePanel
          key={runActive ? 'run' : 'palette'}
          title={runActive ? t('Run') : t('Item palette')}
          name={runActive ? 'run-panel' : 'item-palette'}
          position="left"
          width={runActive ? 300 : undefined}
        >
          {runActive ? <RunPanel /> : <ItemPalette />}
        </SidePanel>
        <div className={styles.treeArea}>
          <TabBar onOpenTree={openTree} />
          <div className={styles.canvasWrap}>
            <TreeCanvas onContextMenu={openContextMenu} />
          </div>
          {runActive && <RunLog />}
        </div>
        <SidePanel title={t('Item Details')} name="item-details" position="right">
          <PropertyPanel />
        </SidePanel>
      </div>
      <FuzzyDialogHost />
      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </div>
  );
}
