import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage } from '../i18n';
import { ProblemsBar } from '../components/ProjectEditor/ProblemsBar';
import { projectEditorStore } from '../store/projectEditorStore';
import ProjectEditor from './ProjectEditor';

const PROJECT_PATH = '/work/owl-bt.json';

const PROJECT = {
  nodes: [{ name: 'Sequence', isComposite: true }, { name: 'Wait' }],
  decorators: [{ name: 'Invert' }],
  scenarios: [{ name: 'Calm', blackboard: { Enemy: false } }],
};

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    fetchProjectMeta: vi.fn(async () => ({
      path: PROJECT_PATH,
      hash: 'hash-1',
      content: JSON.stringify(PROJECT),
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

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/project?path=${encodeURIComponent(PROJECT_PATH)}`]}>
      <Routes>
        <Route path="/project" element={<ProjectEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('project editor in Chinese', () => {
  const initial = getLanguage();

  beforeEach(() => {
    setLanguage('zh');
    projectEditorStore.setState({ dirty: false, undoStack: [], redoStack: [] });
  });

  afterEach(() => {
    cleanup();
    projectEditorStore.getState().disconnect();
    setLanguage(initial);
  });

  it('shows the type list, toolbar and type form in Chinese', async () => {
    renderPage();
    const list = await screen.findByRole('complementary', { name: '项目类型' });
    expect(list.textContent).toContain('组合节点');
    expect(list.textContent).toContain('动作节点');
    expect(list.textContent).toContain('装饰器');
    expect(screen.getByRole('button', { name: /撤销/ })).toBeTruthy();
    expect(screen.getByPlaceholderText('搜索类型 (Ctrl+F)')).toBeTruthy();
    expect(screen.getByText('在左侧选择一个类型，或添加节点、装饰器或服务。')).toBeTruthy();

    act(() => projectEditorStore.getState().select({ view: 'type', kind: 'node', name: 'Wait' }));
    expect(await screen.findByText('组合节点（有子节点）')).toBeTruthy();
    expect(screen.getByRole('region', { name: '基类型' })).toBeTruthy();
    expect(screen.getByText('实时预览')).toBeTruthy();
  });

  it('shows the scenarios view in Chinese', async () => {
    renderPage();
    await screen.findByRole('complementary', { name: '项目类型' });
    act(() => projectEditorStore.getState().select({ view: 'scenarios' }));
    expect(await screen.findByRole('heading', { name: '场景' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '运行场景测试' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '场景 Calm' })).toBeTruthy();
  });

  it('counts problems in Chinese', () => {
    render(
      <ProblemsBar
        issues={[
          { severity: 'error', path: 'nodes[0]', message: 'x' },
          { severity: 'warning', path: 'nodes[1]', message: 'y' },
          { severity: 'warning', path: 'nodes[2]', message: 'z' },
        ]}
        saveError="boom"
        onGo={() => undefined}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('问题：1 个错误，2 个警告');
    expect(screen.getByRole('button').textContent).toContain('未保存：boom');
  });
});
