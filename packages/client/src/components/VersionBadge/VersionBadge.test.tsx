import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERSION, type AppUpdateState, type DesktopBridge } from '@owlbt/shared';
import VersionBadge, { badgeView } from './VersionBadge';

const base: AppUpdateState = { status: 'latest', currentVersion: '0.2.0', canInstall: true };

function fakeBridge(initial: AppUpdateState) {
  let listener: ((state: AppUpdateState) => void) | undefined;
  const bridge: DesktopBridge = {
    getUpdateState: vi.fn(async () => initial),
    checkForUpdate: vi.fn(async () => ({ ...initial, status: 'checking' as const })),
    downloadUpdate: vi.fn(async () => ({ ...initial, status: 'downloading' as const, percent: 0 })),
    installUpdate: vi.fn(async () => undefined),
    onUpdateState: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  return { bridge, push: (state: AppUpdateState) => listener?.(state) };
}

afterEach(() => {
  cleanup();
  delete window.owlbtDesktop;
});

describe('badgeView', () => {
  it('shows the version and re-checks when up to date', () => {
    expect(badgeView(base)).toMatchObject({ label: 'v0.2.0 · Latest', action: 'check' });
  });

  it('offers the download of a newer version', () => {
    const view = badgeView({ ...base, status: 'available', latestVersion: '0.3.0' });
    expect(view).toMatchObject({ label: 'Update to v0.3.0', action: 'download', tone: 'accent' });
    expect(view.title).toContain('installs when owl-bt restarts');
  });

  it('opens the download page when the build cannot install updates', () => {
    const view = badgeView({
      ...base,
      status: 'available',
      latestVersion: '0.3.0',
      canInstall: false,
    });
    expect(view.title).toContain('download page');
  });

  it('shows progress while downloading and is not clickable', () => {
    const view = badgeView({ ...base, status: 'downloading', latestVersion: '0.3.0', percent: 42 });
    expect(view.label).toBe('Downloading v0.3.0 · 42%');
    expect(view.action).toBeUndefined();
  });

  it('restarts into a downloaded update', () => {
    expect(badgeView({ ...base, status: 'downloaded', latestVersion: '0.3.0' })).toMatchObject({
      label: 'Restart to update to v0.3.0',
      action: 'install',
    });
  });

  it('retries after an error and shows it in the tooltip', () => {
    const view = badgeView({ ...base, status: 'error', error: 'offline' });
    expect(view.action).toBe('check');
    expect(view.title).toContain('offline');
  });
});

describe('VersionBadge', () => {
  it('shows only the version in a browser', () => {
    render(<VersionBadge />);
    expect(screen.getByText(`v${VERSION}`)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('follows the desktop update state and acts on click', async () => {
    const { bridge, push } = fakeBridge({ ...base, status: 'available', latestVersion: '0.3.0' });
    window.owlbtDesktop = bridge;
    render(<VersionBadge />);
    const button = await screen.findByRole('button', { name: /v0\.3\.0 is available/ });
    expect(button.textContent).toContain('Update to v0.3.0');

    fireEvent.click(button);
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);

    act(() => push({ ...base, status: 'downloaded', latestVersion: '0.3.0' }));
    fireEvent.click(await screen.findByRole('button', { name: /Click to restart now/ }));
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });
});
