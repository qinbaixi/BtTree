import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUsages, updateReferences } from '../lib/api';
import { DIRTY_TREES_KEY } from '../lib/dirtyTrees';
import { projectEditorStore } from '../store/projectEditorStore';
import ProjectEditor from './ProjectEditor';

const PROJECT_PATH = '/work/owl-bt.json';

const PROJECT = {
  types: { blackboardKey: { type: 'string' } },
  nodes: [
    { name: 'Selector', isComposite: true },
    {
      name: 'MoveTo',
      properties: [{ name: 'Target', type: 'blackboardKey', default: 'Enemy' }],
    },
  ],
  scenarios: [{ name: 'S', blackboard: { Enemy: true } }],
  blackboard: [{ name: 'Enemy', type: 'bool', default: false, extra: 'kept' }],
};

const meta = vi.hoisted(() => ({ content: '' }));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    fetchProjectMeta: vi.fn(async () => ({
      path: '/work/owl-bt.json',
      hash: 'hash-1',
      content: meta.content,
    })),
    saveProject: vi.fn(async () => ({ hash: 'hash-2' })),
    fetchUsages: vi.fn(),
    updateReferences: vi.fn(),
  };
});

vi.mock('../store/projectStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/projectStore')>();
  return {
    ...actual,
    defaultSocketFactory: () => ({ on: () => undefined, disconnect: () => undefined }),
  };
});

function TreeProbe() {
  const location = useLocation();
  return <div>{`tree page ${location.search}`}</div>;
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={[`/project?path=${encodeURIComponent(PROJECT_PATH)}`]}>
      <Routes>
        <Route path="/project" element={<ProjectEditor />} />
        <Route path="/tree" element={<TreeProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function loaded() {
  return screen.findByRole('complementary', { name: 'Project types' });
}

function draft() {
  return projectEditorStore.getState().draft;
}

describe('ProjectEditor references and blackboard', () => {
  beforeEach(() => {
    meta.content = JSON.stringify(PROJECT, null, 2);
    projectEditorStore.setState({ dirty: false, undoStack: [], redoStack: [] });
    vi.mocked(fetchUsages).mockReset();
    vi.mocked(updateReferences).mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    projectEditorStore.getState().disconnect();
  });

  it('edits the declared blackboard keys and renames them everywhere in the file', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /Blackboard/ }));

    const name = await screen.findByRole('textbox', { name: 'Key name Enemy' });
    fireEvent.change(name, { target: { value: 'Foe' } });
    fireEvent.blur(name);

    await waitFor(() => expect(draft()?.blackboard?.[0].name).toBe('Foe'));
    expect(draft()?.blackboard?.[0].extra).toBe('kept');
    expect(draft()?.nodes?.[1].properties?.[0].default).toBe('Foe');
    expect(Object.keys(draft()?.scenarios?.[0].blackboard ?? {})).toEqual(['Foe']);

    fireEvent.click(screen.getByRole('button', { name: '+ Key' }));
    await waitFor(() =>
      expect(draft()?.blackboard?.map((key) => key.name)).toEqual(['Foe', 'Key']),
    );

    // Invalid names are refused.
    const added = screen.getByRole('textbox', { name: 'Key name Key' });
    fireEvent.change(added, { target: { value: '9 lives' } });
    fireEvent.blur(added);
    await waitFor(() => expect(draft()?.blackboard?.[1].name).toBe('Key'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Type of key Key' }), {
      target: { value: 'number' },
    });
    const value = screen.getByRole('textbox', { name: 'Default of key Key' });
    fireEvent.change(value, { target: { value: '42' } });
    fireEvent.blur(value);
    await waitFor(() =>
      expect(draft()?.blackboard?.[1]).toEqual({ name: 'Key', type: 'number', default: 42 }),
    );
  });

  it('reports duplicate keys as problems', async () => {
    meta.content = JSON.stringify({
      ...PROJECT,
      blackboard: [...PROJECT.blackboard, { name: 'Enemy', type: 'string' }],
    });
    renderEditor();
    await loaded();
    expect(await screen.findByRole('button', { name: /Problems: 1 error/ })).toBeTruthy();
  });

  it('finds usages of a type and opens the tree with the item selected', async () => {
    vi.mocked(fetchUsages).mockResolvedValue({
      projectDir: '/work',
      truncated: false,
      errors: [],
      files: [
        {
          path: '/work/trees/a.json',
          relPath: 'trees/a.json',
          usages: [
            {
              nodePath: [0, 1],
              itemKind: 'node',
              type: 'MoveTo',
              label: 'Go',
              location: 'Root › Seq › Go',
            },
          ],
        },
      ],
    });
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^MoveTo/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Find usages in project/ }));

    expect(await screen.findByText('1 usage in 1 file')).toBeTruthy();
    expect(fetchUsages).toHaveBeenCalledWith(PROJECT_PATH, 'node', 'MoveTo');
    fireEvent.click(screen.getByRole('button', { name: /Go/ }));
    const page = await screen.findByText(/tree page/);
    const params = new URLSearchParams(page.textContent?.replace('tree page ', ''));
    expect(params.get('path')).toBe('/work/trees/a.json');
    expect(params.get('select')).toBe('node:0.1');
  });

  it('offers to update the tree files after a rename was saved', async () => {
    window.localStorage.setItem(
      DIRTY_TREES_KEY,
      JSON.stringify([{ path: '/work/trees/b.json', tab: 'other', at: Date.now() }]),
    );
    const changed = [
      { path: '/work/trees/a.json', relPath: 'trees/a.json', count: 2 },
      { path: '/work/trees/b.json', relPath: 'trees/b.json', count: 1 },
    ];
    vi.mocked(updateReferences).mockImplementation(async (_path, _renames, options) => ({
      projectDir: '/work',
      truncated: false,
      dryRun: options?.dryRun === true,
      errors: [],
      changed: options?.dryRun
        ? changed
        : changed.map((file) =>
            options?.skip?.includes(file.path) ? { ...file, skipped: true } : file,
          ),
    }));

    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^MoveTo/ }));
    const nameInput = await screen.findByRole('textbox', { name: 'Type name' });
    fireEvent.change(nameInput, { target: { value: 'Walk' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(projectEditorStore.getState().dirty).toBe(true));

    await projectEditorStore.getState().save();

    const update = await screen.findByRole('button', { name: 'Also update 1 tree file' });
    expect(screen.getByText(/Renamed MoveTo → Walk/)).toBeTruthy();
    expect(screen.getByText(/open with unsaved changes/).textContent).toContain('trees/b.json');
    expect(updateReferences).toHaveBeenCalledWith(
      PROJECT_PATH,
      [{ kind: 'node', from: 'MoveTo', to: 'Walk' }],
      { dryRun: true },
    );

    fireEvent.click(update);
    await waitFor(() =>
      expect(updateReferences).toHaveBeenLastCalledWith(
        PROJECT_PATH,
        [{ kind: 'node', from: 'MoveTo', to: 'Walk' }],
        { skip: ['/work/trees/b.json'] },
      ),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Also update/ })).toBeNull());
    expect(projectEditorStore.getState().savedRenames).toEqual([]);
  });

  it('says nothing when no tree file uses the old name', async () => {
    vi.mocked(updateReferences).mockResolvedValue({
      projectDir: '/work',
      truncated: false,
      dryRun: true,
      errors: [],
      changed: [],
    });
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^MoveTo/ }));
    const nameInput = await screen.findByRole('textbox', { name: 'Type name' });
    fireEvent.change(nameInput, { target: { value: 'Walk' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(projectEditorStore.getState().dirty).toBe(true));
    await projectEditorStore.getState().save();

    await waitFor(() => expect(projectEditorStore.getState().savedRenames).toEqual([]));
    expect(screen.queryByRole('button', { name: /Also update/ })).toBeNull();
  });
});
