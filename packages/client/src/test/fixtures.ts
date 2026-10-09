import type { TreeNodeJson } from '@owlbt/shared';

/** Project file text, as served by GET /api/project. */
export const PROJECT_JSON = JSON.stringify({
  nodes: [
    { name: 'Sequence', isComposite: true, icon: 'arrow-right', color: '#d08038' },
    {
      name: 'Wait',
      icon: 'clock',
      description: 'Waits {{duration}} ms',
      properties: [{ name: 'duration', type: 'number', min: 0, default: 100 }],
    },
  ],
  decorators: [{ name: 'Inverter', icon: 'rotate', description: 'Inverts' }],
  services: [{ name: 'Logger', icon: 'file' }],
});

/** Tree file content, as served by GET /api/tree. */
export const TREE_JSON: TreeNodeJson = {
  type: 'Sequence',
  name: 'root.json',
  label: 'Root',
  childNodes: [
    {
      type: 'Wait',
      label: 'Pause',
      comment: 'short wait',
      properties: [{ name: 'duration', value: 500 }],
      decorators: [{ type: 'Inverter', inverseCheckCondition: true }],
    },
    {
      type: 'Missing',
    },
  ],
  services: [{ type: 'Logger', label: 'log' }],
};
