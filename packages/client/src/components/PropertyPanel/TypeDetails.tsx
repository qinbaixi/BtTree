import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  getItemType,
  type CompiledItemType,
  type CompiledProject,
  type CompiledProperty,
  type ItemKind,
  type TreeNode,
} from '@owlbt/shared';
import { openProjectEditorFromTree } from '../../commands/coreCommands';
import { inspectStore } from '../../store/inspectStore';
import { treeStore, useTreeStore } from '../../store/treeStore';
import { ProjectUsages } from '../ProjectUsages/ProjectUsages';
import { focusNode } from '../TreeCanvas/viewportStore';
import { findTypeUsages, selectionFor, typesOfKind, type TypeUsage } from './treeInspect';
import styles from './PropertyPanel.module.css';
import { t } from '../../i18n';

/** Most usages listed in the panel; the rest is counted. */
export const USAGE_LIMIT = 20;

const KIND_LABEL: Record<ItemKind, string> = {
  node: t('NODE'),
  decorator: t('DECORATOR'),
  service: t('SERVICE'),
};

const PLACEHOLDER_SPLIT = /(\{\{[^{}]*\}\})/;

export interface TypeDetailsProps {
  kind: ItemKind;
  name: string;
  project: CompiledProject;
  root: TreeNode | undefined;
}

/** Definition of a project type: description, bases, appearance, properties and usages in the tree. */
export function TypeDetails({ kind, name, project, root }: TypeDetailsProps) {
  const type = getItemType(project, kind, name);
  const usages = useMemo(() => findTypeUsages(root, kind, name), [root, kind, name]);
  const treePath = useTreeStore((state) => state.treePath);

  return (
    <div className={styles.details}>
      <div className={styles.header} style={{ '--item-color': type.color } as CSSProperties}>
        <span className={styles.badge}>
          {type.icon && <i className={`fa-solid fa-${type.icon}`} aria-hidden="true" />}
        </span>
        <span className={styles.typeName} title={name}>
          {name}
        </span>
        <span className={styles.headTags}>
          {kind === 'node' && !type.isInvalid && (
            <span className={styles.chip}>{type.isComposite ? t('COMPOSITE') : t('ACTION')}</span>
          )}
          <span className={styles.kind}>{KIND_LABEL[kind]}</span>
        </span>
      </div>

      {type.isInvalid ? (
        <p className={styles.error}>{t('This type is no longer in the project file')}</p>
      ) : (
        <TypeBody kind={kind} type={type} project={project} />
      )}

      <fieldset className={styles.fieldset}>
        <legend>{t('Used in this tree: {count}', { count: usages.length })}</legend>
        {usages.length === 0 ? (
          <p className={styles.muted}>{t('Not used in this tree')}</p>
        ) : (
          <UsageList kind={kind} usages={usages} />
        )}
      </fieldset>

      {treePath !== undefined && (
        <fieldset className={styles.fieldset}>
          <legend>{t('Used in the project')}</legend>
          <ProjectUsages
            key={`${kind}:${name}`}
            path={treePath}
            kind={kind}
            name={name}
            beforeOpen={confirmLeaveTree}
          />
        </fieldset>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void openProjectEditorFromTree(treeStore, { kind, name })}
        >
          {t('Edit in project')}
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => inspectStore.getState().clear()}
        >
          {t('Close')}
        </button>
      </div>
    </div>
  );
}

/**
 * Asks before a project usage opens another tree while the open one has unsaved edits. Opening an
 * item of the open tree only selects it.
 */
export function confirmLeaveTree(target: string): boolean {
  const { treePath, dirty } = treeStore.getState();
  if (!dirty || target === treePath) {
    return true;
  }
  return window.confirm(t('The tree has unsaved changes. Open the other tree without saving?'));
}

interface TypeBodyProps {
  kind: ItemKind;
  type: CompiledItemType;
  project: CompiledProject;
}

function TypeBody({ kind, type, project }: TypeBodyProps) {
  const bases = type.bases ?? [];
  const types = typesOfKind(project, kind);

  return (
    <>
      <fieldset className={styles.fieldset}>
        <legend>{t('Description')}</legend>
        {type.description ? (
          <div className={styles.template}>{renderTemplate(type.description)}</div>
        ) : (
          <p className={styles.muted}>{t('No description')}</p>
        )}
      </fieldset>

      {bases.length > 0 && (
        <fieldset className={styles.fieldset}>
          <legend>{t('Inherits from')}</legend>
          <ul className={styles.chipList}>
            {bases.map((base) =>
              Object.hasOwn(types, base) ? (
                <li key={base}>
                  <button
                    type="button"
                    className={`${styles.chip} ${styles.chipButton}`}
                    title={t('Show {name}', { name: base })}
                    onClick={() => inspectStore.getState().inspect(kind, base)}
                  >
                    {base}
                  </button>
                </li>
              ) : (
                <li key={base}>
                  <span className={styles.chip} title={t('abstract')}>
                    {base}
                  </span>
                </li>
              ),
            )}
          </ul>
        </fieldset>
      )}

      <fieldset className={styles.fieldset}>
        <legend>{t('Appearance')}</legend>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>{t('Color')}</span>
          <span className={styles.metaValue}>
            <span
              className={styles.swatch}
              style={{ '--swatch-color': type.color } as CSSProperties}
              aria-hidden="true"
            />
            {type.color}
          </span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>{t('Icon')}</span>
          <span className={styles.metaValue}>
            {type.icon ? (
              <>
                <i className={`fa-solid fa-${type.icon}`} aria-hidden="true" />
                {type.icon}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>{t('Properties')}</legend>
        {type.properties.length === 0 ? (
          <p className={styles.muted}>{t('No properties')}</p>
        ) : (
          type.properties.map((prop) => <PropertyCard key={prop.name} prop={prop} />)
        )}
      </fieldset>
    </>
  );
}

/** Splits a description template so that `{{Name}}` placeholders can be highlighted. */
export function renderTemplate(template: string): ReactNode[] {
  return template.split(PLACEHOLDER_SPLIT).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className={styles.placeholder}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function formatValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Range text of a property: 'min…max', or one-sided bounds. Undefined when unbounded. */
function rangeText(prop: CompiledProperty): string | undefined {
  if (prop.min !== undefined && prop.max !== undefined) {
    return `${prop.min}…${prop.max}`;
  }
  if (prop.min !== undefined) {
    return `≥ ${prop.min}`;
  }
  if (prop.max !== undefined) {
    return `≤ ${prop.max}`;
  }
  return undefined;
}

function PropertyCard({ prop }: { prop: CompiledProperty }) {
  const range = rangeText(prop);
  const hasEnum = prop.values !== undefined && prop.values.length > 0;
  const hasConstraints = range !== undefined || hasEnum || prop.pattern !== undefined;

  return (
    <div className={styles.propCard}>
      <div className={styles.propHead}>
        <span className={styles.propName} title={prop.name}>
          {prop.name}
        </span>
        <span className={styles.propType}>{prop.customType ?? prop.type}</span>
      </div>
      <div className={styles.propDefault}>
        {t('Default:')}{' '}
        {prop.default === undefined ? '—' : <code>{formatValue(prop.default)}</code>}
      </div>
      {hasConstraints && (
        <div className={styles.propMeta}>
          {range !== undefined && <span>{range}</span>}
          {prop.pattern !== undefined && (
            <span>
              {t('pattern')} <code>/{prop.pattern}/</code>
            </span>
          )}
          {hasEnum && (
            <div className={styles.enumChips}>
              {prop.values?.map((value) => (
                <span key={value} className={styles.enumChip}>
                  {value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {prop.description && <p className={styles.propDescription}>{prop.description}</p>}
    </div>
  );
}

interface UsageListProps {
  kind: ItemKind;
  usages: TypeUsage[];
}

function UsageList({ kind, usages }: UsageListProps) {
  const shown = usages.slice(0, USAGE_LIMIT);
  const hidden = usages.length - shown.length;

  return (
    <>
      <ul className={styles.usageList}>
        {shown.map((usage) => (
          <li key={`${usage.nodeId}:${usage.itemId ?? ''}`}>
            <button
              type="button"
              className={styles.usage}
              title={usage.path}
              onClick={() => {
                const selection = selectionFor(kind, usage.nodeId, usage.itemId);
                if (selection) {
                  treeStore.getState().select(selection);
                  focusNode(usage.nodeId);
                }
              }}
            >
              <span className={styles.usageLabel}>{usage.label}</span>
              <span className={styles.usagePath}>{usage.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className={styles.more}>{t('+{count} more', { count: hidden })}</p>}
    </>
  );
}
