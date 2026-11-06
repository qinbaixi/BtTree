import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Router } from 'express';
import { addMissingBuiltins, findMissingBuiltins, type ProjectFile } from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import { withFileLock, writeFileAtomic } from './fileLock';
import { findProjectFile } from './project';
import { formatJsonLike, sha256 } from './projectFile';
import { readTemplate } from './workspace';

function absolutePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new HttpError(400, 'Missing path');
  }
  if (!isAbsolute(raw)) {
    throw new HttpError(400, 'Path must be absolute');
  }
  return raw;
}

async function projectPathOf(path: string): Promise<string> {
  const projectPath = await findProjectFile(path);
  if (!projectPath) {
    throw new HttpError(404, 'No project found');
  }
  return projectPath;
}

function parseProject(text: string, what: string): ProjectFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, `${what} is not valid JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${what} must be a JSON object`);
  }
  return value as ProjectFile;
}

async function readProjectText(projectPath: string): Promise<string> {
  try {
    return await readFile(projectPath, 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new HttpError(404, 'No project found');
    }
    throw err;
  }
}

const readTemplateProject = async () =>
  parseProject(await readTemplate('owl-bt.json'), 'The project template');

/**
 * Built-in types added to the template after a project was created:
 * - GET /project/upgrade?path= lists the missing ones: { projectPath, hash, missing: [{kind, name}] }.
 * - POST /project/upgrade?path= { baseHash? } appends them (definitions from the template) to
 *   owl-bt.json, keeping its formatting. 409 when the file changed since baseHash.
 * Must be registered after the JSON body parser.
 */
export function registerProjectUpgradeRoutes(router: Router): void {
  router.get('/project/upgrade', async (req, res) => {
    const projectPath = await projectPathOf(absolutePath(req.query.path));
    const text = await readProjectText(projectPath);
    const missing = findMissingBuiltins(
      parseProject(text, 'owl-bt.json'),
      await readTemplateProject(),
    );
    res.json({ projectPath, hash: sha256(text), missing });
  });

  router.post('/project/upgrade', async (req, res) => {
    const projectPath = await projectPathOf(absolutePath(req.query.path));
    const body = (req.body ?? {}) as { baseHash?: unknown };
    const template = await readTemplateProject();
    const outcome = await withFileLock(projectPath, async () => {
      const text = await readProjectText(projectPath);
      const hash = sha256(text);
      if (typeof body.baseHash === 'string' && body.baseHash !== hash) {
        return { conflict: true as const, hash };
      }
      const result = addMissingBuiltins(parseProject(text, 'owl-bt.json'), template);
      if (result.added.length === 0) {
        return { conflict: false as const, hash, added: [], addedCustomTypes: [] };
      }
      const next = formatJsonLike(result.project, text);
      await writeFileAtomic(projectPath, next);
      return {
        conflict: false as const,
        hash: sha256(next),
        added: result.added,
        addedCustomTypes: result.addedCustomTypes,
      };
    });
    if (outcome.conflict) {
      res.status(409).json({ message: 'Project file changed on disk', currentHash: outcome.hash });
      return;
    }
    res.json({
      projectPath,
      hash: outcome.hash,
      added: outcome.added,
      addedCustomTypes: outcome.addedCustomTypes,
    });
  });
}
