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

  // Custom export formats: they appear in File > Export, the command palette and the
  // home page, and work with `owlbt export --format csv`.
  exporters: {
    csv: {
      label: 'CSV',
      extension: '.csv',
      // outDir defaults to export/csv
      render(model) {
        const text = (value) => {
          if (value === null || value === undefined) return '';
          if (typeof value === 'object' && 'atom' in value) return value.atom;
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        };
        const quote = (value) => `"${text(value).replace(/"/g, '""')}"`;
        const field = (entry, key) => {
          const found = entry.fields.find(([name]) => name === key);
          return found ? found[1] : null;
        };
        const rows = model.entries.map((entry) =>
          [entry.id, entry.kind, field(entry, 'type'), field(entry, 'sub_type'), entry.comment]
            .map(quote)
            .join(','),
        );
        return ['id,kind,type,sub_type,comment', ...rows].join('\n') + '\n';
      },
    },
  },
};
