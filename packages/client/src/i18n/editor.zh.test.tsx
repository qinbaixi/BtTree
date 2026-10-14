import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '.';
import { badgeView } from '../components/VersionBadge/VersionBadge';
import { themeLabel } from '../lib/theme';
import Home from '../views/Home';

describe('editor texts in Chinese', () => {
  const initial = getLanguage();
  afterEach(() => {
    cleanup();
    setLanguage(initial);
  });

  it('renders the home page in Chinese with a language selector', () => {
    setLanguage('zh');
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '打开行为树' })).toBeTruthy();
    expect(screen.getByPlaceholderText('行为树文件或文件夹路径…')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: '语言' }) as HTMLSelectElement;
    expect(select.value).toBe('zh');
    expect([...select.options].map((option) => option.textContent)).toEqual(['English', '中文']);
  });

  it('translates computed texts and keeps English details', () => {
    setLanguage('zh');
    expect(themeLabel('classic')).toBe('经典深色');
    const view = badgeView({
      status: 'error',
      currentVersion: '1.0.0',
      canInstall: true,
      error: 'Could not check for updates: net::ERR_FAILED',
    });
    expect(view.label).toBe('v1.0.0 · 更新失败');
    expect(view.title).toBe('无法检查更新：net::ERR_FAILED 点击重试。');
  });

  it('stays English by default', () => {
    setLanguage('en');
    expect(themeLabel('classic')).toBe('Classic dark');
  });
});
