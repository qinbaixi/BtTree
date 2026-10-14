import {
  isSubtreeLoaded,
  normalizeSubtreeRef,
  rawSubtreeRef,
  subtreeName,
  type CompiledItemType,
  type SubtreeProblem,
  type TreeNode,
} from '@owlbt/shared';
import { useSubtreeStore } from '../../store/subtreeStore';
import styles from './SubtreeRef.module.css';

export interface SubtreeRefProps {
  node: TreeNode;
  type: CompiledItemType;
  problem?: SubtreeProblem;
}

/** Footer of a subtree reference node: the referenced tree's name, or what is wrong with it. */
export function SubtreeRef({ node, type, problem }: SubtreeRefProps) {
  const result = normalizeSubtreeRef(rawSubtreeRef(node, type));
  const ref = 'ref' in result ? result.ref : undefined;
  const entry = useSubtreeStore((state) => (ref ? state.library[ref] : undefined));
  const loaded = isSubtreeLoaded(entry) ? entry : undefined;

  let title = ref ?? '';
  if (problem) {
    title = problem.message;
  } else if (loaded) {
    const root = loaded.tree;
    title = `${ref} (root: ${root.label ? `${root.label} (${root.type})` : root.type}, ${
      root.childNodes?.length ?? 0
    } child nodes)`;
  }

  return (
    <div
      className={`${styles.ref} ${problem ? styles.problem : ''}`}
      title={title}
      data-subtree-ref={ref ?? ''}
      data-subtree-problem={problem?.kind}
    >
      <i
        className={`fa-solid ${problem ? 'fa-triangle-exclamation' : 'fa-diagram-project'} ${styles.icon}`}
        aria-hidden="true"
      />
      <span className={styles.name}>{ref ? subtreeName(ref) : 'No tree referenced'}</span>
      {problem && problem.kind !== 'empty' && (
        <span className={styles.message}>{problem.message}</span>
      )}
    </div>
  );
}
