import { useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  getEffectiveValue,
  getItemType,
  isSubtreeType,
  setBaseProperty,
  setPropertyValue,
  SUBTREE_PROPERTY,
  validatePropertyValue,
  type CompiledProject,
  type CompiledProperty,
  type SubItem,
  type TreeNode,
} from '@owlbt/shared';
import { useInspectStore } from '../../store/inspectStore';
import { useRunStore } from '../../store/runStore';
import { useProjectStore } from '../../store/projectStore';
import {
  getSelectedItem,
  treeStore,
  useSelectedItem,
  useTreeStore,
  type SelectedItem,
} from '../../store/treeStore';
import { SubtreeSection } from './SubtreeSection';
import { TreeOverview } from './TreeOverview';
import { TypeDetails } from './TypeDetails';
import styles from './PropertyPanel.module.css';

/**
 * Applies a change to the selected item as one undoable step labelled `label`.
 * Returns false when nothing was selected or nothing changed.
 */
export function commitToSelection(
  label: string,
  change: (target: TreeNode | SubItem) => void,
): boolean {
  const { selection } = treeStore.getState();
  if (!selection) {
    return false;
  }
  return treeStore.getState().apply(label, (draft) => {
    const target = getSelectedItem(draft, selection);
    if (target) {
      change(target.subItem ?? target.node);
    }
  });
}

/** Parses a number input: '' -> null (remove the value), a finite number, or undefined (ignore the input). */
function parseNumberInput(raw: string): number | null | undefined {
  if (raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Shows, in order of precedence: the definition of an inspected type (from the palette), the
 * editor of the selected item, or the tree overview.
 */
export default function PropertyPanel() {
  const selected = useSelectedItem();
  const project = useProjectStore((state) => state.project);
  const inspected = useInspectStore((state) => state.inspected);
  const root = useTreeStore((state) => state.root);

  if (inspected) {
    if (!project) {
      return <p className={styles.hint}>Loading project...</p>;
    }
    return (
      <TypeDetails kind={inspected.kind} name={inspected.name} project={project} root={root} />
    );
  }
  if (!selected) {
    return <TreeOverview project={project} root={root} />;
  }
  if (!project) {
    return <p className={styles.hint}>Loading project...</p>;
  }
  return <RunLock>{<ItemDetails selected={selected} project={project} />}</RunLock>;
}

/** The tree is read-only in run mode: the editors are disabled and a note says why. */
function RunLock({ children }: { children: ReactNode }) {
  const runActive = useRunStore((state) => state.active);
  if (!runActive) {
    return <>{children}</>;
  }
  return (
    <>
      <p className={styles.hint}>Read-only in run mode. Leave run mode to edit.</p>
      <fieldset disabled className={styles.runLock}>
        {children}
      </fieldset>
    </>
  );
}

interface ItemDetailsProps {
  selected: SelectedItem;
  project: CompiledProject;
}

function ItemDetails({ selected, project }: ItemDetailsProps) {
  const item: TreeNode | SubItem = selected.subItem ?? selected.node;
  const type = getItemType(project, selected.kind, item.type);
  const sub = selected.subItem;
  const itemId = item.id;
  // Subtree references edit their Tree property in their own section.
  const subtree = selected.kind === 'node' && !sub && isSubtreeType(type);
  const customProperties = subtree
    ? type.properties.filter((prop) => prop.name !== SUBTREE_PROPERTY)
    : type.properties;

  return (
    <div className={styles.details}>
      <div className={styles.header} style={{ '--item-color': type.color } as CSSProperties}>
        <span className={styles.badge}>
          {type.icon && <i className={`fa-solid fa-${type.icon}`} aria-hidden="true" />}
        </span>
        <span className={styles.typeName}>{item.type}</span>
        <span className={styles.kind}>{selected.kind}</span>
      </div>
      {type.isInvalid && <p className={styles.error}>Error: Missing descriptor in project file</p>}

      <fieldset className={styles.fieldset}>
        <legend>Base properties</legend>
        <TextRow itemId={itemId} field="label" label="Label" value={item.label} />
        <TextRow itemId={itemId} field="comment" label="Comment" value={item.comment} />

        {selected.kind === 'decorator' && sub && (
          <>
            <CheckRow
              itemId={itemId}
              field="inverseCheckCondition"
              label="Inverse check condition"
              checked={sub.inverseCheckCondition === true}
            />
            <CheckRow
              itemId={itemId}
              field="periodic"
              label="Periodic check"
              checked={sub.periodic === true}
            />
          </>
        )}
        {selected.kind === 'service' && sub && (
          <>
            <NumberRow
              itemId={itemId}
              field="timeBetweenTicks"
              label="Time Between Ticks"
              value={sub.timeBetweenTicks}
            />
            <NumberRow
              itemId={itemId}
              field="firstTickTime"
              label="First Tick Time"
              value={sub.firstTickTime}
            />
          </>
        )}
      </fieldset>

      {subtree && (
        <SubtreeSection
          node={selected.node}
          type={type}
          onCommit={(value) =>
            commitToSelection('Set Tree', (target) =>
              setPropertyValue(target, SUBTREE_PROPERTY, value),
            )
          }
        />
      )}

      {!type.isInvalid && (!subtree || customProperties.length > 0) && (
        <fieldset className={styles.fieldset}>
          <legend>Custom properties</legend>
          {customProperties.map((prop) => (
            <PropertyField
              key={prop.name}
              itemId={itemId}
              prop={prop}
              properties={item.properties}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** Text input that commits on blur or Enter. The value is local until committed. */
type CommitInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onBlur' | 'defaultValue'
> & {
  value: string;
  onCommit(raw: string): void;
};

function CommitInput({ value, onCommit, ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface TextRowProps {
  itemId: string;
  field: 'label' | 'comment';
  label: string;
  value: string | undefined;
}

function TextRow({ itemId, field, label, value }: TextRowProps) {
  const id = `${itemId}-${field}`;
  return (
    <div className={styles.row}>
      <label htmlFor={id}>{label}</label>
      <CommitInput
        id={id}
        key={`${itemId}:${field}:${JSON.stringify(value ?? null)}`}
        className={styles.control}
        type="text"
        value={value ?? ''}
        onCommit={(raw) =>
          commitToSelection(`Set ${label}`, (target) =>
            setBaseProperty(target, field, raw === '' ? null : raw),
          )
        }
      />
    </div>
  );
}

interface NumberRowProps {
  itemId: string;
  field: 'timeBetweenTicks' | 'firstTickTime';
  label: string;
  value: number | undefined;
}

function NumberRow({ itemId, field, label, value }: NumberRowProps) {
  const id = `${itemId}-${field}`;
  return (
    <div className={styles.row}>
      <label htmlFor={id}>{label}</label>
      <CommitInput
        id={id}
        key={`${itemId}:${field}:${JSON.stringify(value ?? null)}`}
        className={styles.control}
        type="number"
        value={value === undefined ? '' : String(value)}
        onCommit={(raw) => {
          const parsed = parseNumberInput(raw);
          if (parsed !== undefined) {
            commitToSelection(`Set ${label}`, (target) => setBaseProperty(target, field, parsed));
          }
        }}
      />
    </div>
  );
}

interface CheckRowProps {
  itemId: string;
  field: 'inverseCheckCondition' | 'periodic';
  label: string;
  checked: boolean;
}

function CheckRow({ itemId, field, label, checked }: CheckRowProps) {
  return (
    <div className={styles.row}>
      <label className={styles.check} htmlFor={`${itemId}-${field}`}>
        <input
          id={`${itemId}-${field}`}
          type="checkbox"
          checked={checked}
          onChange={(event) =>
            commitToSelection(`Set ${label}`, (target) =>
              setBaseProperty(target, field, event.target.checked ? true : null),
            )
          }
        />
        {label}
      </label>
    </div>
  );
}

interface PropertyFieldProps {
  itemId: string;
  prop: CompiledProperty;
  properties: Record<string, unknown>;
}

function PropertyField({ itemId, prop, properties }: PropertyFieldProps) {
  const explicit = Object.hasOwn(properties, prop.name) && properties[prop.name] !== undefined;
  const effective = getEffectiveValue(prop, properties);
  const valid = validatePropertyValue(prop, effective);
  const id = `${itemId}-prop-${prop.name}`;

  const commit = (value: unknown, label: string) =>
    commitToSelection(label, (target) => setPropertyValue(target, prop.name, value));

  const className = [
    styles.control,
    valid ? '' : styles.invalid,
    explicit ? '' : styles.defaultValue,
  ]
    .filter(Boolean)
    .join(' ');
  const flags = {
    'data-invalid': valid ? undefined : 'true',
    'data-default': explicit ? undefined : 'true',
  };
  // Keyed by the value so that undo/redo and selection changes re-sync the uncontrolled inputs.
  const inputKey = `${itemId}:${prop.name}:${JSON.stringify(effective ?? null)}`;

  let control: ReactNode;
  if (prop.type === 'bool') {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={effective === true}
        onChange={(event) => commit(event.target.checked, `Set ${prop.name}`)}
        {...flags}
      />
    );
  } else if (prop.type === 'enum') {
    const values = prop.values ?? [];
    const current = typeof effective === 'string' ? effective : '';
    // A value outside the list is kept as an extra option so that it can be seen and fixed.
    const options = current !== '' && !values.includes(current) ? [...values, current] : values;
    control = (
      <select
        id={id}
        className={className}
        value={current}
        onChange={(event) =>
          commit(event.target.value === '' ? null : event.target.value, `Set ${prop.name}`)
        }
        {...flags}
      >
        <option value="" />
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (prop.type === 'number' && prop.pattern === undefined) {
    control = (
      <CommitInput
        id={id}
        key={inputKey}
        className={className}
        type="number"
        min={prop.min}
        max={prop.max}
        value={effective === undefined || effective === null ? '' : String(effective)}
        onCommit={(raw) => {
          const parsed = parseNumberInput(raw);
          if (parsed !== undefined) {
            commit(parsed, `Set ${prop.name}`);
          }
        }}
        {...flags}
      />
    );
  } else {
    // Strings, and custom types with a pattern (numbers keep their numeric type).
    const isNumber = prop.type === 'number';
    control = (
      <CommitInput
        id={id}
        key={inputKey}
        className={className}
        type={isNumber ? 'number' : 'text'}
        pattern={prop.pattern}
        value={effective === undefined || effective === null ? '' : String(effective)}
        onCommit={(raw) => {
          if (isNumber) {
            const parsed = parseNumberInput(raw);
            if (parsed !== undefined) {
              commit(parsed, `Set ${prop.name}`);
            }
          } else {
            commit(raw, `Set ${prop.name}`);
          }
        }}
        {...flags}
      />
    );
  }

  return (
    <div className={styles.row}>
      {prop.type === 'bool' ? (
        <label className={styles.check} htmlFor={id} title={prop.description}>
          {control}
          {prop.name}
        </label>
      ) : (
        <label htmlFor={id} title={prop.description}>
          {prop.name}
        </label>
      )}
      {prop.type !== 'bool' && control}
      {explicit && (
        <button
          type="button"
          className={styles.reset}
          title="Reset to default"
          aria-label={`Reset ${prop.name}`}
          onClick={() => commit(null, `Reset ${prop.name}`)}
        >
          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
