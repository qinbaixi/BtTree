import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectFile } from '@owlbt/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSubtreeExportMode } from '../components/ProjectEditor/ExportSettingsView';
import { projectEditorStore } from '../store/projectEditorStore';
import ProjectEditor from './ProjectEditor';

const PROJECT_PATH = '/work/owl-bt.json';

const PROJECT = {
  nodes: [
    { name: 'Selector', isComposite: true, icon: 'question' },
    { name: 'Run', icon: 'play', properties: [{ name: 'Speed', type: 'number' }] },
  ],
};

const meta = vi.hoisted(() => ({
  content: '',
  exporters: [] as Array<{ format: string; label: string; extension: string; outDir: string }>,
  pluginError: undefined as string | undefined,
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    fetchProjectMeta: vi.fn(async () => ({
      path: PROJECT_PATH,
      hash: 'h1',
      content: meta.content,
    })),
    saveProject: vi.fn(async () => ({ hash: 'h2' })),
    fetchPluginExporters: vi.fn(async () => ({
      exporters: meta.exporters,
      warnings: [],
      error: meta.pluginError,
    })),
  };
});

vi.mock('../store/projectStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/projectStore')>();
  return {
    ...actual,
    defaultSocketFactory: () => ({ on: () => undefined, disconnect: () => undefined }),
  };
});

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={[`/project?path=${encodeURIComponent(PROJECT_PATH)}`]}>
      <Routes>
        <Route path="/project" element={<ProjectEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

const draft = () => projectEditorStore.getState().draft;

describe('project editor: subtree references', () => {
  beforeEach(() => {
    meta.content = JSON.stringify(PROJECT, null, 2);
    meta.exporters = [];
    meta.pluginError = undefined;
    projectEditorStore.setState({ dirty: false, undoStack: [], redoStack: [] });
  });

  afterEach(() => {
    cleanup();
    projectEditorStore.getState().disconnect();
  });

  it('marks a node type as a subtree reference and adds the Tree property', async () => {
    renderEditor();
    const list = await screen.findByRole('complementary', { name: 'Project types' });
    fireEvent.click(within(list).getByRole('button', { name: /^Run/ }));

    const toggle = await screen.findByRole('checkbox', { name: /Subtree reference/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(draft()?.nodes?.[1].subtree).toBe(true));
    expect(draft()?.nodes?.[1].properties?.map((p) => p.name)).toEqual(['Speed', 'Tree']);
    expect((screen.getByRole('checkbox', { name: /Composite/ }) as HTMLInputElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Subtree reference/ }));
    await waitFor(() => expect(draft()?.nodes?.[1].subtree).toBeUndefined());
    // The property stays; it is ordinary data once the type is no reference any more.
    expect(draft()?.nodes?.[1].properties?.map((p) => p.name)).toEqual(['Speed', 'Tree']);
  });

  it('sets the subtree export mode in the export settings', async () => {
    renderEditor();
    const list = await screen.findByRole('complementary', { name: 'Project types' });
    fireEvent.click(within(list).getByRole('button', { name: /Export settings/ }));
    const select = await screen.findByRole('combobox', { name: 'Subtree export mode' });
    expect((select as HTMLSelectElement).value).toBe('reference');
    fireEvent.change(select, { target: { value: 'inline' } });
    await waitFor(() => expect(draft()?.export?.subtrees).toBe('inline'));
    fireEvent.change(select, { target: { value: 'reference' } });
    await waitFor(() => expect(draft()?.export).toBeUndefined());
  });

  it('edits the output settings of plugin formats', async () => {
    meta.exporters = [{ format: 'xml', label: 'XML', extension: '.xml', outDir: 'out/xml' }];
    renderEditor();
    const list = await screen.findByRole('complementary', { name: 'Project types' });
    fireEvent.click(within(list).getByRole('button', { name: /Export settings/ }));
    const folder = (await screen.findByRole('textbox', {
      name: 'XML output folder',
    })) as HTMLInputElement;
    expect(folder.placeholder).toBe('out/xml');
    fireEvent.change(folder, { target: { value: 'build/xml' } });
    fireEvent.blur(folder);
    await waitFor(() => expect(draft()?.export).toEqual({ xml: { outDir: 'build/xml' } }));
    const name = screen.getByRole('textbox', { name: 'XML file name' });
    fireEvent.change(name, { target: { value: 'bt_{name}' } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(draft()?.export).toEqual({ xml: { outDir: 'build/xml', fileName: 'bt_{name}' } }),
    );
  });

  it('says why plugin formats are missing from the export settings', async () => {
    meta.pluginError = 'owl-bt.js is not trusted';
    renderEditor();
    const list = await screen.findByRole('complementary', { name: 'Project types' });
    fireEvent.click(within(list).getByRole('button', { name: /Export settings/ }));
    expect(
      await screen.findByText('Plugin export formats are unavailable: owl-bt.js is not trusted'),
    ).toBeTruthy();
  });

  it('keeps other export settings when the mode changes', () => {
    const file: ProjectFile = { export: { lua: { outDir: 'out' } } };
    setSubtreeExportMode(file, 'inline');
    expect(file.export).toEqual({ lua: { outDir: 'out' }, subtrees: 'inline' });
    setSubtreeExportMode(file, undefined);
    expect(file.export).toEqual({ lua: { outDir: 'out' } });
  });
});
