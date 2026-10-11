#!/usr/bin/env node
/* global console, process */
// Builds the GitHub Release notes for a version from CHANGELOG.md.
// Usage: node scripts/release-notes.mjs <version|vX.Y.Z> [output file]
// Prints to stdout when no output file is given. Exits with 1 when the version has no section.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Section body of `## [version]` up to the next `## [` heading or the link references. */
export function extractSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) {
    return undefined;
  }
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line) || /^\[[^\]]+\]:\s/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join('\n').trim();
}

/** Release notes: the section's intro paragraph, a download table, then the section with `##` headings. */
export function buildReleaseNotes(changelog, version, repo = 'qinbaixi/BtTree') {
  const section = extractSection(changelog, version);
  if (section === undefined) {
    return undefined;
  }
  const firstHeading = section.search(/^### /m);
  const intro = (firstHeading < 0 ? '' : section.slice(0, firstHeading)).trim();
  const details = (firstHeading < 0 ? section : section.slice(firstHeading))
    .replace(/^### /gm, '## ')
    .trim();

  const downloads = [
    '## 下载',
    '',
    '| 文件 | 说明 |',
    '| --- | --- |',
    `| \`owl-bt-setup-${version}.exe\` | Windows 安装版，可选择安装目录，创建桌面和开始菜单快捷方式 |`,
    `| \`owl-bt-portable-${version}.exe\` | Windows 便携版，双击即可运行，无需安装 |`,
    '',
    '无需安装 Node.js。程序未签名，首次运行若被 SmartScreen 拦截，点击「更多信息 → 仍要运行」。',
  ].join('\n');

  return [
    intro,
    downloads,
    details,
    `完整说明见 [README](https://github.com/${repo}#readme) 与 [CHANGELOG](https://github.com/${repo}/blob/main/CHANGELOG.md)。`,
  ]
    .filter((part) => part !== '')
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .concat('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [arg, out] = process.argv.slice(2);
  if (!arg) {
    console.error('Usage: node scripts/release-notes.mjs <version|vX.Y.Z> [output file]');
    process.exit(1);
  }
  const version = arg.replace(/^refs\/tags\//, '').replace(/^v/, '');
  const notes = buildReleaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (notes === undefined) {
    console.error(`CHANGELOG.md has no section "## [${version}]". Add one before releasing.`);
    process.exit(1);
  }
  if (out) {
    writeFileSync(out, notes);
  } else {
    process.stdout.write(notes);
  }
}
