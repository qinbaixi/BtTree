import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import VersionBadge from './components/VersionBadge/VersionBadge';
import { setUnsavedChangesCheck } from './i18n';
import { installGlobalErrorListeners } from './lib/globalErrors';
import { projectEditorStore } from './store/projectEditorStore';
import { selectAnyDirty, tabsStore } from './store/tabsStore';
import Home from './views/Home';
import { useDirtyTabsBeacon } from './views/useTreeLinks';

// Lazy-load the heavy editor routes so opening Home does not load d3, canvas or project-editor code.
const Editor = lazy(() => import('./views/Editor'));
const ProjectEditor = lazy(() => import('./views/ProjectEditor'));

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
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tree" element={<Editor />} />
            <Route path="/project" element={<ProjectEditor />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <VersionBadge />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
