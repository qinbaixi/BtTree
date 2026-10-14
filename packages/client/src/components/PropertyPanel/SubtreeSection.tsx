import { useEffect, useState } from 'react';
import {
  isSubtreeLoaded,
  normalizeSubtreeRef,
  rawSubtreeRef,
  subtreeName,
  type CompiledItemType,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { commandContext } from '../../commands/registry';
import { openSubtreeOfNode } from '../../commands/subtreeCommands';
import { fetchWorkspace } from '../../lib/api';
import { useRunStore } from '../../store/runStore';
import { useSubtreeProblem, useSubtreeStore } from '../../store/subtreeStore';
import styles from './PropertyPanel.module.css';
import own from './SubtreeSection.module.css';

/** Children of the referenced root listed in the preview; the rest is counted. */
export const PREVIEW_LIMIT = 8;

const treeLists = new Map<string, Promise<string[]>>();

/** Project-relative paths of the project's tree files, fetched once per project folder. */
export function loadProjectTrees(projectDir: string): Promise<string[]> {
  let cached = treeLists.get(projectDir);
  if (!cached) {
    cached = fetchWorkspace(projectDir).then(
      (workspace) => workspace.trees.map((tree) => tree.relPath),
      () => [],
    );
    treeLists.set(projectDir, cached);
  }
  return cached;
}

/** Forgets the cached tree lists (tests, and after a picker refresh). */
export function clearProjectTreesCache(): void {
  treeLists.clear();
}

function nodeText(node: TreeNodeJson): string {
  return node.label ? `${node.label} (${node.type})` : node.type;
}

export interface SubtreeSectionProps {
  node: TreeNode;
  type: CompiledItemType;
  /** Writes the new reference (null removes it). */
  onCommit(value: string | null): void;
}

/**
 * Editor of a subtree reference node: the referenced tree (with the project's tree files as
 * suggestions), its state, a preview of its top level and a button that opens it.
 */
export function SubtreeSection({ node, type, onCommit }: SubtreeSectionProps) {
  const projectDir = useSubtreeStore((state) => state.projectDir);
  const self = useSubtreeStore((state) => state.self);
  const loading = useSubtreeStore((state) => state.loading);
  const problem = useSubtreeProblem(node.id);
  const runActive = useRunStore((state) => state.active);
  const raw = rawSubtreeRef(node, type);
  const text = typeof raw === 'string' ? raw : '';
  const result = normalizeSubtreeRef(raw);
  const ref = 'ref' in result ? result.ref : undefined;
  const entry = useSubtreeStore((state) => (ref ? state.library[ref] : undefined));
  const [draft, setDraft] = useState(text);
  const [trees, setTrees] = useState<string[]>([]);
  const listId = `${node.id}-subtree-trees`;

  // Undo / redo and selection changes replace the value.
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }

  useEffect(() => {
    if (!projectDir) {
      return undefined;
    }
    let active = true;
    void loadProjectTrees(projectDir).then((list) => {
      if (active) setTrees(list.filter((path) => path !== self));
    });
    return () => {
      active = false;
    };
  }, [projectDir, self]);

  const commit = (value: string): void => {
    const next = value.trim();
    if (next !== text) {
      onCommit(next === '' ? null : next);
    }
  };

  const loaded = isSubtreeLoaded(entry) ? entry.tree : undefined;
  const children = loaded?.childNodes ?? [];
  const id = `${node.id}-subtree`;

  return (
    <fieldset className={styles.fieldset}>
      <legend>Subtree</legend>
      <div className={styles.row}>
        <label htmlFor={id} title="Tree file to run, relative to the project folder">
          Tree
        </label>
        <input
          id={id}
          className={`${styles.control} ${problem ? styles.invalid : ''}`}
          type="text"
          list={listId}
          value={draft}
          placeholder="trees/common.json"
          data-invalid={problem ? 'true' : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            // Picking a suggestion commits at once.
            if (trees.includes(event.target.value)) {
              commit(event.target.value);
            }
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <datalist id={listId}>
          {trees.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </div>
      {problem ? (
        <p className={styles.error} role="alert">
          {problem.message}
        </p>
      ) : ref && !entry && loading ? (
        <p className={styles.muted}>Loading referenced tree...</p>
      ) : null}
      {loaded && ref && (
        <div className={own.preview} aria-label="Referenced tree preview">
          <div className={own.previewTitle}>
            <i className="fa-solid fa-diagram-project" aria-hidden="true" /> {subtreeName(ref)}
            <span className={own.root}>{nodeText(loaded)}</span>
          </div>
          {children.length > 0 && (
            <ul className={own.children}>
              {children.slice(0, PREVIEW_LIMIT).map((child, index) => (
                <li key={index}>{nodeText(child)}</li>
              ))}
              {children.length > PREVIEW_LIMIT && (
                <li className={own.more}>+{children.length - PREVIEW_LIMIT} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        className={styles.textButton}
        disabled={!loaded || runActive}
        onClick={() => void openSubtreeOfNode(commandContext, node.id)}
      >
        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> Open referenced
        tree
      </button>
    </fieldset>
  );
}
