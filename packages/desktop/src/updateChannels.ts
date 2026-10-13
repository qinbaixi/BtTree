/** IPC channel names shared by the main process (updater.ts) and the preload (preload.ts). */
export const UPDATE_CHANNELS = {
  get: 'owlbt:update:get',
  check: 'owlbt:update:check',
  download: 'owlbt:update:download',
  install: 'owlbt:update:install',
  state: 'owlbt:update:state',
} as const;
