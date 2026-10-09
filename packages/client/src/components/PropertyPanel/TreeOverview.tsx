import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CompiledProject, ItemKind, TreeNode } from '@owlbt/shared';
import { fetchWorkspace } from '../../lib/api';
import { getPathLastSegment } from '../../lib/mru';
import { inspectStore } from '../../store/inspectStore';
import { treeStore, useTreeStore } from '../../store/treeStore';
import { focusNode } from '../TreeCanvas/viewportStore';
import { selectionFor, summarizeTree, type TreeProblem, type UsedType } from './treeInspect';
import styles from './PropertyPanel.module.css';

/** Most problems listed in the panel; the rest is counted. */
export const PROBLEM_LIMIT = 50;

const USED_GROUPS: { kind: ItemKind; title: string }[] = [
  { kind: 'node', title: 'Nodes' },
  { kind: 'decorator', title: 'Decorators' },
  { kind: 'service', title: 'Services' },
];

/** Directory that holds a tree file, for either separator style. */
export function treeDirectory(treePath: string): string {
  const index = Math.max(treePath.lastIndexOf('/'), treePath.lastIndexOf('\\'));
  if (index < 0) {
    return '.';
  }
  return index === 0 ? treePath.slice(0, 1) : treePath.slice(0, index);
}

const projectPaths = new Map<string, Promise<string | undefined>>();

/**
 * Path of the project file that applies to a tree. Fetched once per tree path; failures
 * resolve to undefined (the project row is then hidden).
 */
export function loadProjectPath(treePath: string): Promise<string | undefined> {
  let cached = projectPaths.get(treePath);
  if (!cached) {
    cached = fetchWorkspace(treeDirectory(treePath)).then(
      (workspace) => workspace.projectPath,
      () => undefined,
    );
    projectPaths.set(treePath, cached);
  }
  return cached;
}

/** Forgets the cached project paths (tests). */
export function clearProjectPathCache(): void {
  projectPaths.clear();
}

interface LoadedProjectPath {
  treePath: string;
  path?: string;
}

export interface TreeOverviewProps {
  project: CompiledProject | undefined;
  root: TreeNode | undefined;
}

/** Summary of the open tree: file, project, statistics, problems and the types it uses. */
export function TreeOverview({ project, root }: TreeOverviewProps) {
  const treePath = useTreeStore((state) => state.treePath);
  const dirty = useTreeStore((state) => state.dirty);
  const loading = useTreeStore((state) => state.loading);
  const error = useTreeStore((state) => state.error);

  const fileName = treePath ? getPathLastSegment(treePath) : 'Tree';
  const header = (
    <div className={styles.header} style={{ '--item-color': 'var(--accent)' } as CSSProperties}>
      <span className={styles.badge}>
        <i className="fa-solid fa-sitemap" aria-hidden="true" />
      </span>
      <span className={styles.typeName} title={treePath}>
        {fileName}
      </span>
      <span className={styles.kind}>TREE</span>
    </div>
  );

  if (!root) {
    return (
      <div className={styles.details}>
        {header}
        <p className={styles.hint}>
          {error ? `Failed to load tree: ${error}` : loading ? 'Loading tree...' : 'No tree loaded'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.details}>
      {header}
      <FileSection treePath={treePath} dirty={dirty} />
      {project ? (
        <OverviewBody root={root} project={project} />
      ) : (
        <p className={styles.muted}>Loading project...</p>
      )}
      <p className={styles.muted}>Select a node to edit its properties</p>
    </div>
  );
}

interface FileSectionProps {
  treePath: string | undefined;
  dirty: boolean;
}

function FileSection({ treePath, dirty }: FileSectionProps) {
  const [loaded, setLoaded] = useState<LoadedProjectPath | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!treePath) {
      return undefined;
    }
    let active = true;
    void loadProjectPath(treePath).then((path) => {
      if (active) {
        setLoaded({ treePath, path });
      }
    });
    return () => {
      active = false;
    };
  }, [treePath]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const projectLoading = treePath !== undefined && loaded?.treePath !== treePath;
  const projectPath = loaded?.treePath === treePath ? loaded?.path : undefined;

  const copyPath = async () => {
    if (!treePath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(treePath);
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure context or denied); nothing to report.
    }
  };

  return (
    <fieldset className={styles.fieldset}>
      <legend>File</legend>
      <div className={styles.pathRow}>
        <p className={styles.path}>{treePath}</p>
        {navigator.clipboard && (
          <button
            type="button"
            className={styles.iconButton}
            title={copied ? 'Copied' : 'Copy path'}
            aria-label="Copy path"
            onClick={() => void copyPath()}
          >
            <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className={styles.dirtyStatus}>
        {dirty ? (
          <>
            <span className={styles.dirtyDot} aria-hidden="true" />
            Unsaved changes
          </>
        ) : (
          'All changes saved'
        )}
      </p>
      {projectLoading && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Project</span>
          <span className={styles.metaValue}>Loading…</span>
        </div>
      )}
      {projectPath && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Project</span>
          <span className={styles.metaValue} title={projectPath}>
            {projectPath}
          </span>
        </div>
      )}
    </fieldset>
  );
}

interface OverviewBodyProps {
  root: TreeNode;
  project: CompiledProject;
}

function OverviewBody({ root, project }: OverviewBodyProps) {
  const summary = useMemo(() => summarizeTree(root, project), [root, project]);
  const stats: { label: string; value: number }[] = [
    { label: 'Nodes', value: summary.nodes },
    { label: 'Composite', value: summary.composite },
    { label: 'Actions', value: summary.actions },
    { label: 'Decorators', value: summary.decorators },
    { label: 'Services', value: summary.services },
    { label: 'Max depth', value: summary.maxDepth },
  ];
  const shownProblems = summary.problems.slice(0, PROBLEM_LIMIT);
  const hiddenProblems = summary.problems.length - shownProblems.length;

  return (
    <>
      <fieldset className={styles.fieldset}>
        <legend>Statistics</legend>
        <div className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.stat}>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>{`Problems: ${summary.problems.length}`}</legend>
        {summary.problems.length === 0 ? (
          <p className={styles.success}>No problems found</p>
        ) : (
          <>
            <ul className={styles.problemList}>
              {shownProblems.map((problem) => (
                <li key={`${problem.nodeId}:${problem.itemId ?? ''}:${problem.kind}`}>
                  <ProblemButton problem={problem} />
                </li>
              ))}
            </ul>
            {hiddenProblems > 0 && <p className={styles.more}>{`+${hiddenProblems} more`}</p>}
          </>
        )}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Types used</legend>
        {USED_GROUPS.every((group) => summary.usedTypes[group.kind].length === 0) && (
          <p className={styles.muted}>No types used</p>
        )}
        {USED_GROUPS.map((group) => (
          <UsedTypesGroup
            key={group.kind}
            title={group.title}
            kind={group.kind}
            types={summary.usedTypes[group.kind]}
          />
        ))}
      </fieldset>
    </>
  );
}

function ProblemButton({ problem }: { problem: TreeProblem }) {
  return (
    <button
      type="button"
      className={styles.problem}
      title={problem.path}
      onClick={() => {
        const selection = selectionFor(problem.kind, problem.nodeId, problem.itemId);
        if (selection) {
          treeStore.getState().select(selection);
          focusNode(problem.nodeId);
        }
      }}
    >
      <span className={styles.problemTitle}>{problem.type}</span>
      <span className={styles.problemMessage}>{problem.message}</span>
      <span className={styles.problemPath}>{problem.path}</span>
    </button>
  );
}

interface UsedTypesGroupProps {
  title: string;
  kind: ItemKind;
  types: UsedType[];
}

function UsedTypesGroup({ title, kind, types }: UsedTypesGroupProps) {
  if (types.length === 0) {
    return null;
  }
  return (
    <div className={styles.usedGroup}>
      <p className={styles.usedGroupTitle}>{title}</p>
      <ul className={styles.chipList}>
        {types.map((used) => (
          <li key={used.name}>
            <button
              type="button"
              className={[styles.chip, styles.chipButton, used.missing ? styles.chipMissing : '']
                .filter(Boolean)
                .join(' ')}
              title={used.missing ? `${used.name} is missing from the project file` : used.name}
              onClick={() => inspectStore.getState().inspect(kind, used.name)}
            >
              {used.name}
              <span className={styles.chipCount}>{`×${used.count}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
