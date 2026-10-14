import type { ItemKind, ProjectFile, ProjectIssue } from '@owlbt/shared';
import { LIST_KEY } from '@owlbt/shared';
import type { ProjectSelection } from '../../store/projectEditorStore';

const LIST_PATH = /^(nodes|decorators|services)\[(\d+)\]/;
const SCENARIO_PATH = /^scenarios\[/;
const BLACKBOARD_PATH = /^blackboard(?:\[(\d+)\])?/;
const CUSTOM_PATH = /^types\.(.+)\.(type|pattern)$/;

const KIND_OF_KEY: Record<'nodes' | 'decorators' | 'services', ItemKind> = {
  nodes: 'node',
  decorators: 'decorator',
  services: 'service',
};

/** The type (`kind`, `name`) a validation path belongs to, when it names one. */
export function typeOfPath(
  draft: ProjectFile,
  path: string,
): { kind: ItemKind; name: string } | undefined {
  const match = LIST_PATH.exec(path);
  if (!match) {
    return undefined;
  }
  const kind = KIND_OF_KEY[match[1] as keyof typeof KIND_OF_KEY];
  const desc = draft[LIST_KEY[kind]]?.[Number(match[2])];
  return desc ? { kind, name: desc.name } : undefined;
}

/** Where to go for a validation issue: the type, or the custom type for `types.<name>.*` paths. */
export function selectionForPath(draft: ProjectFile, path: string): ProjectSelection | undefined {
  const type = typeOfPath(draft, path);
  if (type) {
    return { view: 'type', ...type };
  }
  const custom = CUSTOM_PATH.exec(path);
  if (custom) {
    return { view: 'custom', name: custom[1] };
  }
  if (SCENARIO_PATH.test(path)) {
    return { view: 'scenarios' };
  }
  const blackboard = BLACKBOARD_PATH.exec(path);
  if (blackboard) {
    const index = blackboard[1];
    const name = index === undefined ? undefined : draft.blackboard?.[Number(index)]?.name;
    return typeof name === 'string' ? { view: 'blackboard', name } : { view: 'blackboard' };
  }
  return undefined;
}

export interface IssueCounts {
  errors: number;
  warnings: number;
}

/** Error and warning counts per type, keyed `kind:name`. */
export function countIssuesByType(
  draft: ProjectFile,
  issues: readonly ProjectIssue[],
): Map<string, IssueCounts> {
  const counts = new Map<string, IssueCounts>();
  for (const issue of issues) {
    const type = typeOfPath(draft, issue.path);
    if (!type) {
      continue;
    }
    const key = `${type.kind}:${type.name}`;
    const entry = counts.get(key) ?? { errors: 0, warnings: 0 };
    if (issue.severity === 'error') {
      entry.errors++;
    } else {
      entry.warnings++;
    }
    counts.set(key, entry);
  }
  return counts;
}

/** Placeholder names (`{{Name}}`) in a description that do not match a known property name. */
export function unknownPlaceholders(description: string, propNames: readonly string[]): string[] {
  const unknown = new Set<string>();
  for (const match of description.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!propNames.includes(match[1])) {
      unknown.add(match[1]);
    }
  }
  return [...unknown];
}
