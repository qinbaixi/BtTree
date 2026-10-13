import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import VersionBadge from './components/VersionBadge/VersionBadge';
import { installGlobalErrorListeners } from './lib/globalErrors';
import Editor from './views/Editor';
import Home from './views/Home';
import ProjectEditor from './views/ProjectEditor';

export default function App() {
  useEffect(() => installGlobalErrorListeners(), []);

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
