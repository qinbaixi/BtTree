/* global module */
'use strict';

// Sample exporter: the file name (csv) is the format name. It shows up in File > Export,
// the command palette, the home page and the export settings, and works with
// `owlbt export --format csv`. Output goes to export/csv unless configured otherwise.
module.exports = {
  label: 'CSV',
  extension: '.csv',

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
};
