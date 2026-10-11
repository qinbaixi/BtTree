import { useMemo, useState } from 'react';
import {
  compileProject,
  DEFAULT_COLORS,
  LIST_KEY,
  type CompiledItemType,
  type CompiledProject,
  type ItemKind,
  type ProjectFile,
  type SubItem,
  type TreeNode,
} from '@owlbt/shared';
import { themeLabel, type ThemeId } from '../../lib/theme';
import { TreeNodeView } from '../TreeCanvas/TreeNodeView';
import { TextInput } from './TextInput';
import { ValueInput } from './PropertyTable';
import styles from './ProjectEditor.module.css';

/** Name of the node that shows a decorator or service when the project has no composite node. */
export const STAND_IN_NODE = 'ExampleComposite';

const BUCKET: Record<ItemKind, 'nodes' | 'decorators' | 'services'> = {
  node: 'nodes',
  decorator: 'decorators',
  service: 'services',
};

export interface PreviewModel {
  project: CompiledProject;
  type: CompiledItemType;
  /** Host node for decorators and services. */
  hostType: string;
  standIn: boolean;
}

/**
 * Compiles the draft for the preview. The selected type is previewed even when it is abstract.
 * Returns an error text when the project does not compile.
 */
export function buildPreview(
  draft: ProjectFile,
  kind: ItemKind,
  name: string,
): PreviewModel | { error: string } {
  // Only the previewed descriptor changes; compileProject does not modify its input.
  const listKey = LIST_KEY[kind];
  const copy: ProjectFile = {
    ...draft,
    [listKey]: draft[listKey]?.map((item) =>
      item.name === name ? { ...item, isAbstract: false } : item,
    ),
  };
  let project: CompiledProject;
  try {
    project = compileProject(copy);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const type = project[BUCKET[kind]][name] as CompiledItemType | undefined;
  if (!type) {
    return { error: `'${name}' does not compile` };
  }

  let hostType = Object.keys(project.nodes).find((node) => project.nodes[node].isComposite) ?? '';
  let standIn = false;
  if (kind !== 'node' && hostType === '') {
    hostType = STAND_IN_NODE;
    standIn = true;
    project = {
      ...project,
      nodes: {
        ...project.nodes,
        [STAND_IN_NODE]: {
          kind: 'node',
          name: STAND_IN_NODE,
          icon: 'sitemap',
          color: DEFAULT_COLORS.composite,
          isComposite: true,
          properties: [],
        },
      },
    };
  }
  return { project, type, hostType, standIn };
}

function isError(model: PreviewModel | { error: string }): model is { error: string } {
  return 'error' in model;
}

export interface TypePreviewProps {
  draft: ProjectFile;
  kind: ItemKind;
  name: string;
}

/** Right column: the type as a tree card in both themes, with sample values and the compiled JSON. */
export function TypePreview({ draft, kind, name }: TypePreviewProps) {
  const model = useMemo(() => buildPreview(draft, kind, name), [draft, kind, name]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [withLabel, setWithLabel] = useState(false);
  const [label, setLabel] = useState('Example');
  const [invalid, setInvalid] = useState(false);

  if (isError(model)) {
    return (
      <aside className={styles.preview} aria-label="Preview">
        <div className={styles.previewHead}>Preview</div>
        <p role="alert" className={styles.errorText}>
          Cannot preview: {model.error}
        </p>
      </aside>
    );
  }

  const { type, hostType, standIn } = model;
  let project = model.project;
  if (invalid) {
    const bucket = BUCKET[kind];
    project = {
      ...project,
      [bucket]: { ...project[bucket], [name]: { ...type, isInvalid: true } },
    };
  }
  const shownType = invalid ? { ...type, isInvalid: true } : type;

  const sampleSub = (sub: 'decorator' | 'service'): SubItem[] => {
    const bucket = sub === 'decorator' ? project.decorators : project.services;
    const first = Object.keys(bucket)[0];
    if (first === undefined || (kind === sub && first === name)) {
      return [];
    }
    return [{ id: `sample-${sub}`, type: first, properties: {}, extra: {} }];
  };
  const subItem: SubItem = {
    id: 'preview-sub',
    type: name,
    properties: values,
    extra: {},
    label: withLabel ? label : undefined,
  };
  const node: TreeNode =
    kind === 'node'
      ? {
          id: 'preview-node',
          type: name,
          properties: values,
          label: withLabel ? label : undefined,
          decorators: [...(kind === 'node' ? sampleSub('decorator') : [])],
          services: sampleSub('service'),
          childNodes: [],
          extra: {},
        }
      : {
          id: 'preview-host',
          type: hostType,
          properties: {},
          decorators: kind === 'decorator' ? [subItem] : [],
          services: kind === 'service' ? [subItem] : [],
          childNodes: [],
          extra: {},
        };

  const themes: ThemeId[] = ['light', 'classic'];

  return (
    <aside className={styles.preview} aria-label="Preview">
      <div className={styles.previewHead}>Live preview</div>
      {standIn && (
        <p className={styles.muted}>Shown on an example node: the project has no composite node.</p>
      )}
      <div className={styles.previewOptions}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={withLabel}
            onChange={(event) => setWithLabel(event.target.checked)}
          />
          With label
        </label>
        {withLabel && (
          <TextInput
            value={label}
            ariaLabel="Preview label"
            className={styles.input}
            onCommit={setLabel}
            live
          />
        )}
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={invalid}
            onChange={(event) => setInvalid(event.target.checked)}
          />
          Invalid
        </label>
      </div>

      {themes.map((theme) => (
        <div key={theme} className={styles.previewStage} data-theme={theme}>
          <div className={styles.previewLabel}>{themeLabel(theme)}</div>
          <TreeNodeView
            node={node}
            project={project}
            x={12}
            y={36}
            selected={false}
            interactive={false}
          />
        </div>
      ))}

      <details className={styles.section} open>
        <summary className={styles.sectionTitle}>Sample values</summary>
        {shownType.properties.length === 0 && <p className={styles.muted}>No properties.</p>}
        {shownType.properties.map((prop) => (
          <div key={prop.name} className={styles.sampleRow}>
            <span className={styles.small}>{prop.name}</span>
            <ValueInput
              type={prop.type}
              values={prop.values}
              value={values[prop.name]}
              ariaLabel={`Sample ${prop.name}`}
              placeholder={
                prop.default === undefined ? '(none)' : `default: ${String(prop.default)}`
              }
              onChange={(value) =>
                setValues((current) => {
                  const next = { ...current };
                  if (value === undefined) {
                    delete next[prop.name];
                  } else {
                    next[prop.name] = value;
                  }
                  return next;
                })
              }
            />
          </div>
        ))}
        {Object.keys(values).length > 0 && (
          <button type="button" className={styles.textButton} onClick={() => setValues({})}>
            Reset sample values
          </button>
        )}
      </details>

      <details className={styles.section}>
        <summary className={styles.sectionTitle}>Compiled type</summary>
        <pre className={styles.compiled}>{JSON.stringify(shownType, null, 2)}</pre>
      </details>
    </aside>
  );
}
