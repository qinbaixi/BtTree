import { isAbsolute } from 'node:path';
import type { Router } from 'express';
import { isRefKind } from '@owlbt/shared';
import { HttpError } from './errors';
import { findProjectUsages, parseRenames, updateProjectReferences } from './references';

function absolutePath(raw: unknown, name: string): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new HttpError(400, `Missing ${name}`);
  }
  if (!isAbsolute(raw)) {
    throw new HttpError(400, `${name[0].toUpperCase()}${name.slice(1)} must be absolute`);
  }
  return raw;
}

/**
 * Project-wide references:
 * - GET /usages?path=&kind=node|decorator|service|blackboardKey&name= lists where a type or a
 *   blackboard key is used in the tree files of the project that contains `path`.
 * - POST /references/rename { path, renames: [{kind, from, to}], dryRun?, skip?: [treePath] }
 *   rewrites the tree files for renamed types and keys (or only counts with dryRun).
 * Must be registered after the JSON body parser.
 */
export function registerReferenceRoutes(router: Router): void {
  router.get('/usages', async (req, res) => {
    const path = absolutePath(req.query.path, 'path');
    const kind = req.query.kind;
    const name = req.query.name;
    if (!isRefKind(kind)) {
      throw new HttpError(400, 'kind must be node, decorator, service or blackboardKey');
    }
    if (typeof name !== 'string' || name === '') {
      throw new HttpError(400, 'Missing name');
    }
    res.json(await findProjectUsages(path, { kind, name }));
  });

  router.post('/references/rename', async (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Body must be a JSON object');
    }
    const fields = body as Record<string, unknown>;
    const path = absolutePath(fields.path, 'path');
    const renames = parseRenames(fields.renames);
    const skip = fields.skip;
    if (
      skip !== undefined &&
      (!Array.isArray(skip) || skip.some((entry) => typeof entry !== 'string'))
    ) {
      throw new HttpError(400, 'skip must be an array of paths');
    }
    res.json(
      await updateProjectReferences(path, renames, {
        dryRun: fields.dryRun === true,
        skip: skip as string[] | undefined,
      }),
    );
  });
}
