import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectEditorStore } from '../store/projectEditorStore';
import ProjectEditor from './ProjectEditor';

const PROJECT_PATH = '/work/owl-bt.json';

const PROJECT = {
  types: { key: { type: 'string', pattern: '[A-Za-z_]+' } },
  nodes: [
    { name: 'Selector', isComposite: true, icon: 'question', color: '#d08038' },
    { name: 'Base', isAbstract: true, icon: 'gear' },
    {
      name: 'Wait',
      base: 'Base',
      icon: 'clock',
      description: 'Waits {{duration}} ms',
      properties: [{ name: 'duration', type: 'number', min: 0, default: 1 }],
    },
  ],
  decorators: [{ name: 'Inverter', icon: 'rotate' }],
  services: [{ name: 'Logger', icon: 'file' }],
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
  };
});

vi.mock('../store/projectStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/projectStore')>();
  return {
    ...actual,
    defaultSocketFactory: () => ({ on: () => undefined, disconnect: () => undefined }),
  };
});

function renderEditor(url = `/project?path=${encodeURIComponent(PROJECT_PATH)}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/project" element={<ProjectEditor />} />
        <Route path="/tree" element={<div>tree page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Waits until the project has loaded and the type list is shown. */
async function loaded() {
  return screen.findByRole('complementary', { name: 'Project types' });
}

function draft() {
  return projectEditorStore.getState().draft;
}

describe('ProjectEditor page', () => {
  beforeEach(() => {
    meta.content = JSON.stringify(PROJECT, null, 2);
    projectEditorStore.setState({ dirty: false, undoStack: [], redoStack: [] });
  });

  afterEach(() => {
    cleanup();
    projectEditorStore.getState().disconnect();
  });

  it('lists the types grouped by kind with counts', async () => {
    renderEditor();
    const list = await loaded();
    expect(within(list).getByRole('region', { name: 'Composite nodes' }).textContent).toContain(
      'Selector',
    );
    expect(within(list).getByRole('region', { name: 'Action nodes' }).textContent).toContain(
      'Wait',
    );
    expect(within(list).getByRole('region', { name: 'Decorators' }).textContent).toContain(
      'Inverter',
    );
    expect(within(list).getByRole('region', { name: 'Services' }).textContent).toContain('Logger');
    expect(within(list).getByRole('button', { name: /Custom types/ }).textContent).toContain('1');
  });

  it('shows the form of the selected type and marks abstract types', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    const nameInput = await screen.findByRole('textbox', { name: 'Type name' });
    expect((nameInput as HTMLInputElement).value).toBe('Wait');
    expect(within(list).getByText('← Base')).toBeTruthy();
    expect(within(list).getByText('abstract')).toBeTruthy();
  });

  it('renames a type and updates the base references', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Base/ }));

    const nameInput = await screen.findByRole('textbox', { name: 'Type name' });
    fireEvent.change(nameInput, { target: { value: 'Root' } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(draft()?.nodes?.map((node) => node.name)).toContain('Root'));
    expect(draft()?.nodes?.find((node) => node.name === 'Wait')?.base).toBe('Root');
    expect(projectEditorStore.getState().dirty).toBe(true);
  });

  it('adds a property with a unique name to the selected type', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    fireEvent.click(await screen.findByRole('button', { name: '+ Property' }));

    await waitFor(() =>
      expect(
        draft()
          ?.nodes?.find((node) => node.name === 'Wait')
          ?.properties?.map((p) => p.name),
      ).toEqual(['duration', 'Property']),
    );
  });

  it('goes back to the tree it was opened from', async () => {
    renderEditor(
      `/project?path=${encodeURIComponent(PROJECT_PATH)}&from=${encodeURIComponent('/work/trees/demo.json')}`,
    );
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /Back to demo.json/ }));
    expect(await screen.findByText('tree page')).toBeTruthy();
  });

  it('goes back home and asks before dropping unsaved edits', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Property' }));
    await waitFor(() => expect(projectEditorStore.getState().dirty).toBe(true));

    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const back = screen.getByRole('button', { name: /Back to Home/ });
    fireEvent.click(back);
    expect(screen.queryByText('home page')).toBeNull();
    fireEvent.click(back);
    expect(await screen.findByText('home page')).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('deletes a property with the button on its card', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete duration' }));

    await waitFor(() =>
      expect(draft()?.nodes?.find((node) => node.name === 'Wait')?.properties ?? []).toEqual([]),
    );
  });

  it('resizes the preview with the keyboard and remembers the width', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    const handle = await screen.findByRole('separator', { name: 'Resize preview' });
    const start = Number(handle.getAttribute('aria-valuenow'));
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(start + 20);
    expect(window.localStorage.getItem('owlbt.previewWidth')).toBe(String(start + 20));
  });

  it('picks an icon from the icon dialog with a filter', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Choose…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose icon' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search icons' });
    fireEvent.change(search, { target: { value: 'arrow-right' } });
    expect(within(dialog).getByRole('option', { name: 'arrow-right' })).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: 'github' })).toBeNull();

    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() =>
      expect(draft()?.nodes?.find((node) => node.name === 'Wait')?.icon).toBe('arrow-right'),
    );
    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).toBeNull();
  });

  it('shows the description rendered with the property defaults in the preview', async () => {
    renderEditor();
    const list = await loaded();
    fireEvent.click(within(list).getByRole('button', { name: /^Wait/ }));

    // Once in each theme of the preview.
    const rendered = await screen.findAllByText('Waits 1 ms');
    expect(rendered).toHaveLength(2);
    expect(rendered[0].closest('[data-theme]')?.getAttribute('data-theme')).toBe('light');
    expect(rendered[1].closest('[data-theme]')?.getAttribute('data-theme')).toBe('classic');
  });

  it('shows validation problems and selects the type of a problem', async () => {
    meta.content = JSON.stringify({
      ...PROJECT,
      nodes: [...PROJECT.nodes, { name: 'Lost', base: 'Nope' }],
    });
    renderEditor();
    await loaded();

    const toggle = await screen.findByRole('button', { name: /Problems: 1 error/ });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: /Missing base 'Nope'/ }));

    expect(
      ((await screen.findByRole('textbox', { name: 'Type name' })) as HTMLInputElement).value,
    ).toBe('Lost');
  });

  it('shows a load error for a file that is not valid JSON', async () => {
    meta.content = '{"nodes":';
    renderEditor();
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to load the project');
  });

  it('asks for a path when none is given', () => {
    renderEditor('/project');
    expect(screen.getByText(/No project path given/)).toBeTruthy();
  });
});
