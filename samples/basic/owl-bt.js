/* global module */
'use strict';

// Sample project plugin (CommonJS). Edits are picked up on the next request.
module.exports = {
  onTreeLoad() {
    // nothing to do on load
  },

  onTreeSave(ctx) {
    if (ctx.tree.label === 'forbidden') {
      return 'Root label must not be "forbidden"';
    }
    return undefined;
  },
};
