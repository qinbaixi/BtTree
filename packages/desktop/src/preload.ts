/* owl-bt desktop: preload of the editor window. Exposes the update API as window.owlbtDesktop. */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppUpdateState, DesktopBridge } from '@owlbt/shared';
import { UPDATE_CHANNELS } from './updateChannels';

const bridge: DesktopBridge = {
  getUpdateState: () => ipcRenderer.invoke(UPDATE_CHANNELS.get),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
  installUpdate: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
  onUpdateState(listener) {
    const handler = (_event: IpcRendererEvent, state: AppUpdateState): void => listener(state);
    ipcRenderer.on(UPDATE_CHANNELS.state, handler);
    return () => {
      ipcRenderer.removeListener(UPDATE_CHANNELS.state, handler);
    };
  },
};

contextBridge.exposeInMainWorld('owlbtDesktop', bridge);
