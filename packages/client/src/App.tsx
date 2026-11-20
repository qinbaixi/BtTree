import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import VersionBadge from './components/VersionBadge/VersionBadge';
import { setUnsavedChangesCheck } from './i18n';
import { installGlobalErrorListeners } from './lib/globalErrors';
import { projectEditorStore } from './store/projectEditorStore';
import { selectAnyDirty, tabsStore } from './store/tabsStore';
import Editor from './views/Editor';
import Home from './views/Home';
import ProjectEditor from './views/ProjectEditor';
import { useDirtyTabsBeacon } from './views/useTreeLinks';

export default function App() {
  useEffect(() => installGlobalErrorListeners(), []);
  useEffect(() => {
    setUnsavedChangesCheck(
      () => selectAnyDirty(tabsStore.getState()) || projectEditorStore.getState().dirty,
    );
    return () => setUnsavedChangesCheck(undefined);
  }, []);
  useDirtyTabsBeacon();

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tree" element={<Editor />} />
          <Route path="/project" element={<ProjectEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <VersionBadge />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
