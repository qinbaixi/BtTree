import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  findNode,
  getItemType,
  type CompiledProject,
  type LogEntry,
  type LogKind,
  type TickResult,
  type TreeNode,
} from '@owlbt/shared';
import { focusNode } from '../TreeCanvas/viewportStore';
import { PanelResizer } from '../ProjectEditor/PanelResizer';
import { getJson, setJson } from '../../lib/storage';
import { useProjectStore } from '../../store/projectStore';
import { runStore, useRunStore } from '../../store/runStore';
import { runViewStore, useRunViewStore } from '../../store/runViewStore';
import { treeStore, useTreeStore } from '../../store/treeStore';
import {
  buildDepthMap,
  buildExportIdMap,
  clampLogHeight,
  entryInfo,
  entryParts,
  isDecoratorFail,
  LOG_DEFAULT_HEIGHT,
  LOG_HEIGHT_STORAGE_KEY,
  LOG_KINDS,
  LOG_MAX_RATIO,
  LOG_MIN_HEIGHT,
  nodeInfo,
  parseBlackboardMessage,
  resultTone,
  type RunOverrides,
  selectionForEntry,
  summarizeTick,
} from './runHelpers';
import styles from './RunMode.module.css';

const KIND_LABEL: Record<LogKind, string> = {
  enter: 'Enter',
  result: 'Result',
  decorator: 'Decorator',
  service: 'Service',
  blackboard: 'Blackboard',
  error: 'Error',
  pass: 'Run',
};

/** Ticks rendered at most (older ones are behind a "show earlier" button). */
const PAGE = 200;
const MAX_BB_CHIPS = 3;
/** Active nodes listed in a collapsed row (the rest is "+N"). */
const MAX_ACTIVE = 3;
const NEAR_BOTTOM = 24;
const INDENT = 14;

function typeColor(project: CompiledProject | undefined, node: TreeNode | undefined) {
  return project && node ? getItemType(project, 'node', node.type).color : undefined;
}

interface GroupProps {
  index: number;
  tick: TickResult;
  /** The run (pass) number changed since the previous tick. */
  passStart: boolean;
  root: TreeNode | undefined;
  project: CompiledProject | undefined;
  depths: Map<string, number>;
  ids: ReadonlyMap<string, number>;
  overrides: RunOverrides;
  showIds: boolean;
  expanded: boolean;
  current: boolean;
  future: boolean;
  breakpointHit: boolean;
  kinds: ReadonlySet<LogKind>;
  onToggle(index: number): void;
}

const TickGroup = memo(function TickGroup({
  index,
  tick,
  passStart,
  root,
  project,
  depths,
  ids,
  overrides,
  showIds,
  expanded,
  current,
  future,
  breakpointHit,
  kinds,
  onToggle,
}: GroupProps) {
  const summary = useMemo(() => summarizeTick(tick, root), [tick, root]);
  const visible = useMemo(
    () => (expanded ? tick.log.filter((entry) => kinds.has(entry.kind)) : []),
    [expanded, tick, kinds],
  );
  const hiddenBb = Math.max(0, summary.bbChanges.length - MAX_BB_CHIPS);

  return (
    <li
      className={styles.group}
      data-tick={index}
      data-current={current ? 'true' : undefined}
      data-future={future ? 'true' : undefined}
    >
      {passStart && (
        <div className={styles.passDivider} role="separator" data-testid="pass-divider">
          Run {tick.pass}
        </div>
      )}
      <div className={styles.groupHead}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={expanded}
          aria-label={`Tick ${tick.tick}`}
          onClick={() => onToggle(index)}
        >
          <i
            className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} ${styles.chevron}`}
            aria-hidden="true"
          />
          <span className={styles.tickBadge}>Tick {tick.tick}</span>
          {tick.passes !== 1 && (
            <span className={styles.runBadge} data-testid="run-badge">
              Run {tick.pass}
            </span>
          )}
          <span className={styles.summary}>
            {summary.finished ? (
              <span className={`${styles.pill} ${styles[`pill_${summary.finished}`]}`}>
                Tree finished: {summary.finished === 'success' ? 'Success' : 'Failure'}
              </span>
            ) : summary.passResult ? (
              <span
                className={`${styles.pill} ${styles[`pill_${summary.passResult}`]}`}
                data-testid="pass-result"
              >
                Run finished: {summary.passResult === 'success' ? 'Success' : 'Failure'}
              </span>
            ) : summary.activeNodes.length === 0 ? (
              <span className={`${styles.pill} ${styles.pill_idle}`}>Idle</span>
            ) : (
              <>
                {summary.activeNodes.slice(0, MAX_ACTIVE).map((id, i) => {
                  const node = root ? findNode(root, id) : undefined;
                  const info = nodeInfo(root, project, ids, overrides, id);
                  const waiting = summary.manualPending === id;
                  const full = [
                    info.exportId !== undefined ? `#${info.exportId}` : '',
                    info.type ? `${info.name} (${info.type})` : info.name,
                    info.description ? `— ${info.description}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <Fragment key={id}>
                      {i > 0 && (
                        <span className={styles.activeSep} aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className={styles.active} data-testid="active-node" title={full}>
                        <span
                          className={styles.typeChip}
                          style={{
                            background: typeColor(project, node) ?? 'var(--item-color-default)',
                          }}
                          aria-hidden="true"
                        />
                        {showIds && info.exportId !== undefined && (
                          <span className={styles.idPill} data-testid="node-id">
                            #{info.exportId}
                          </span>
                        )}
                        <span className={styles.activeName}>{info.name}</span>
                        {info.type && <span className={styles.activeType}>({info.type})</span>}
                        {info.description && (
                          <span className={styles.activeDesc} data-testid="node-desc">
                            — {info.description}
                          </span>
                        )}
                        <span
                          className={`${styles.pill} ${waiting ? styles.pill_waiting : styles.pill_running}`}
                        >
                          {waiting ? 'Waiting' : 'Running'}
                        </span>
                      </span>
                    </Fragment>
                  );
                })}
                {summary.activeNodes.length > MAX_ACTIVE && (
                  <span className={styles.muted}>+{summary.activeNodes.length - MAX_ACTIVE}</span>
                )}
              </>
            )}
          </span>
          <span className={styles.extras}>
            {summary.bbChanges.slice(0, MAX_BB_CHIPS).map((change) => (
              <span
                key={change.key}
                className={styles.bbChip}
                title={`${change.key}: ${change.from} → ${change.to}`}
              >
                {change.key} {change.from}→{change.to}
              </span>
            ))}
            {hiddenBb > 0 && <span className={styles.bbChip}>+{hiddenBb} more</span>}
            {summary.decoratorFails > 0 && (
              <span className={styles.counter} title="Decorator checks failed">
                <i className="fa-solid fa-filter" aria-hidden="true" /> {summary.decoratorFails}
              </span>
            )}
            {summary.errors > 0 && (
              <span className={`${styles.counter} ${styles.counterError}`} title="Errors">
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />{' '}
                {summary.errors}
              </span>
            )}
            {breakpointHit && (
              <span className={styles.counter} title="Breakpoint hit">
                <i className="fa-solid fa-circle-pause" aria-hidden="true" />
              </span>
            )}
            {summary.manualPending && (
              <span className={styles.counter} title="Waiting for a manual result">
                <i className="fa-solid fa-hand" aria-hidden="true" />
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          className={styles.viewButton}
          aria-label={`View tick ${index}`}
          title="Show this tick on the canvas"
          onClick={() => runStore.getState().seek(index)}
        >
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <ul className={styles.trace} aria-label={`Tick ${index} entries`}>
          {visible.length === 0 && <li className={styles.traceEmpty}>No entries to show.</li>}
          {visible.map((entry, i) => (
            <TraceLine
              key={i}
              entry={entry}
              root={root}
              project={project}
              ids={ids}
              overrides={overrides}
              showIds={showIds}
              depth={depths.get(entry.nodeId) ?? 0}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

function iconFor(entry: LogEntry): { icon: string; tone: string } {
  switch (entry.kind) {
    case 'enter':
      return { icon: 'fa-arrow-right-to-bracket', tone: 'neutral' };
    case 'result': {
      const tone = resultTone(entry.message);
      const icon =
        tone === 'success' ? 'fa-circle-check' : tone === 'failure' ? 'fa-circle-xmark' : 'fa-ban';
      return { icon, tone };
    }
    case 'decorator':
      return { icon: 'fa-filter', tone: isDecoratorFail(entry.message) ? 'failure' : 'success' };
    case 'service':
      return { icon: 'fa-bolt', tone: 'service' };
    case 'blackboard':
      return { icon: 'fa-table', tone: 'blackboard' };
    case 'error':
      return { icon: 'fa-triangle-exclamation', tone: 'error' };
    case 'pass':
      return {
        icon: 'fa-repeat',
        tone: /finished: Success$/.test(entry.message)
          ? 'success'
          : /finished: Failure$/.test(entry.message)
            ? 'failure'
            : 'pass',
      };
  }
}

function TraceLine({
  entry,
  root,
  project,
  ids,
  overrides,
  showIds,
  depth,
}: {
  entry: LogEntry;
  root: TreeNode | undefined;
  project: CompiledProject | undefined;
  ids: ReadonlyMap<string, number>;
  overrides: RunOverrides;
  showIds: boolean;
  depth: number;
}) {
  const { icon, tone } = iconFor(entry);
  const parts = entryParts(root, entry);
  const info = entryInfo(root, project, ids, overrides, entry);
  const description = entry.kind === 'enter' ? info.description : undefined;
  const change = entry.kind === 'blackboard' ? parseBlackboardMessage(entry.message) : undefined;
  return (
    <li>
      <button
        type="button"
        className={`${styles.traceLine} ${styles[`tone_${tone}`]}`}
        data-kind={entry.kind}
        data-depth={depth}
        style={{ paddingLeft: 12 + depth * INDENT }}
        onClick={() => {
          const selection = selectionForEntry(treeStore.getState().root, entry);
          if (selection) {
            treeStore.getState().select(selection);
            focusNode(entry.nodeId);
          }
        }}
      >
        <i className={`fa-solid ${icon} ${styles.traceIcon}`} aria-hidden="true" />
        {showIds && info.exportId !== undefined && (
          <span className={styles.idPill} data-testid="trace-id">
            #{info.exportId}
          </span>
        )}
        <span className={styles.traceName}>{parts.name}</span>
        {parts.type && <span className={styles.muted}>{parts.type}</span>}
        {parts.item && <span className={styles.traceItem}>/ {parts.item}</span>}
        {change ? (
          <span className={styles.diff}>
            <span className={styles.diffKey}>{change.key}:</span>{' '}
            <span className={styles.diffOld}>{change.from}</span> →{' '}
            <span className={styles.diffNew}>{change.to}</span>
          </span>
        ) : (
          <span className={styles.traceMessage}>{entry.message}</span>
        )}
        {description && (
          <span className={styles.traceDesc} title={description} data-testid="trace-desc">
            {description}
          </span>
        )}
      </button>
    </li>
  );
}

/** Collapsible, resizable run log grouped by tick, with a kind filter and the replay timeline. */
export default function RunLog() {
  const history = useRunStore((state) => state.history);
  const dropped = useRunStore((state) => state.dropped);
  const runId = useRunStore((state) => state.runId);
  const viewIndex = useRunStore((state) => state.viewIndex);
  const breakpoints = useRunStore((state) => state.breakpoints);
  const propOverrides = useRunStore((state) => state.overrides);
  const showIds = useRunViewStore((state) => state.showIds);
  const root = useTreeStore((state) => state.root);
  const project = useProjectStore((state) => state.project);
  const [collapsed, setCollapsed] = useState(false);
  const [kinds, setKinds] = useState<ReadonlySet<LogKind>>(() => new Set(LOG_KINDS));
  // Manual open / close per tick; ticks without an entry follow their default (errors open).
  const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [limit, setLimit] = useState(PAGE);
  const [height, setHeight] = useState(() =>
    getJson<number>(LOG_HEIGHT_STORAGE_KEY, LOG_DEFAULT_HEIGHT),
  );
  // Height of the editor area the log sits in (its parent); the log may take 70% of it at most.
  const [area, setArea] = useState(() => window.innerHeight);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const atBottom = useRef(true);

  // A new run (new initial snapshot) starts from scratch.
  const [seenRun, setSeenRun] = useState(runId);
  if (seenRun !== runId) {
    setSeenRun(runId);
    setOverrides(new Map());
    setLimit(PAGE);
  }

  // Without dropped ticks history[0] is the state before the first tick, which has no entries.
  const floor = dropped > 0 ? 0 : 1;
  const last = Math.max(0, history.length - 1);
  const live = viewIndex >= last;
  const depths = useMemo(() => buildDepthMap(root), [root]);
  const ids = useMemo(() => buildExportIdMap(root), [root]);

  useLayoutEffect(() => {
    const measure = (): void => {
      const parent = rootRef.current?.parentElement;
      setArea(parent?.clientHeight || window.innerHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const errorTicks = useMemo(() => {
    const set = new Set<number>();
    history.forEach((tick, i) => {
      if (tick.log.some((entry) => entry.kind === 'error')) set.add(i);
    });
    return set;
  }, [history]);

  const toggle = useCallback(
    (index: number) =>
      setOverrides((current) => {
        const next = new Map(current);
        next.set(index, !(current.get(index) ?? errorTicks.has(index)));
        return next;
      }),
    [errorTicks],
  );
  const setAll = (open: boolean): void => {
    const next = new Map<number, boolean>();
    for (let i = floor; i < history.length; i++) next.set(i, open);
    setOverrides(next);
  };

  // Newest ticks only; the replayed tick stays reachable.
  const first = Math.max(floor, history.length - limit);
  const start = viewIndex >= floor && viewIndex < first ? viewIndex : first;

  const breakpointTicks = useMemo(() => {
    const set = new Set<number>();
    if (breakpoints.size === 0) return set;
    history.forEach((tick, i) => {
      if (tick.log.some((entry) => entry.kind === 'enter' && breakpoints.has(entry.nodeId))) {
        set.add(i);
      }
    });
    return set;
  }, [history, breakpoints]);

  // Follow the newest ticks while the user is at the bottom.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && live && atBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [history.length, live, collapsed, overrides]);

  // Bring the replayed tick into view.
  useEffect(() => {
    if (live || collapsed) return;
    const group = listRef.current?.querySelector(`[data-tick="${viewIndex}"]`);
    (group as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [viewIndex, live, collapsed]);

  const toggleKind = (kind: LogKind): void => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  const effectiveHeight = clampLogHeight(height, area);
  const resize = (value: number): void => {
    const clamped = clampLogHeight(value, area);
    setHeight(clamped);
    setJson(LOG_HEIGHT_STORAGE_KEY, clamped);
  };

  const groups: number[] = [];
  for (let i = start; i < history.length; i++) groups.push(i);

  return (
    <div
      ref={rootRef}
      className={`${styles.log} ${collapsed ? styles.logCollapsed : ''}`}
      style={collapsed ? undefined : { height: effectiveHeight }}
    >
      {!collapsed && (
        <PanelResizer
          orientation="horizontal"
          value={effectiveHeight}
          onResize={resize}
          min={LOG_MIN_HEIGHT}
          max={Math.max(LOG_MIN_HEIGHT, Math.floor(area * LOG_MAX_RATIO))}
          defaultValue={LOG_DEFAULT_HEIGHT}
          label="Resize run log"
          title="Drag to resize the log (double click to reset)"
        />
      )}
      <div className={styles.logHead}>
        <button
          type="button"
          className={styles.iconButton}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand run log' : 'Collapse run log'}
          onClick={() => setCollapsed(!collapsed)}
        >
          <i
            className={`fa-solid ${collapsed ? 'fa-angle-up' : 'fa-angle-down'}`}
            aria-hidden="true"
          />
        </button>
        <span className={styles.logTitle}>Run log</span>
        <div className={styles.timeline}>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={Math.min(viewIndex, last)}
            disabled={last === 0}
            aria-label="Timeline"
            onChange={(event) => runStore.getState().seek(Number(event.target.value))}
          />
          <span className={styles.timelineLabel}>
            {history[viewIndex]?.tick ?? 0} / {history[last]?.tick ?? 0}
          </span>
          {!live && (
            <button
              type="button"
              className={styles.link}
              onClick={() => runStore.getState().backToLive()}
            >
              live
            </button>
          )}
        </div>
        <label className={styles.idToggle} title="Show the export node id (#N) next to nodes">
          <input
            type="checkbox"
            checked={showIds}
            onChange={(event) => runViewStore.getState().setShowIds(event.target.checked)}
          />
          Show node ids
        </label>
        {!collapsed && (
          <div className={styles.logActions}>
            <button type="button" className={styles.link} onClick={() => setAll(true)}>
              Expand all
            </button>
            <button type="button" className={styles.link} onClick={() => setAll(false)}>
              Collapse all
            </button>
          </div>
        )}
        <div className={styles.filters} role="group" aria-label="Log filter">
          {LOG_KINDS.map((kind) => (
            <label key={kind} className={styles.filter}>
              <input type="checkbox" checked={kinds.has(kind)} onChange={() => toggleKind(kind)} />
              {KIND_LABEL[kind]}
            </label>
          ))}
        </div>
      </div>
      {!collapsed && (
        <ul
          ref={listRef}
          className={styles.logList}
          aria-label="Run log entries"
          onScroll={(event) => {
            const list = event.currentTarget;
            atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM;
          }}
        >
          {dropped > 0 && (
            <li className={styles.logEmpty} data-testid="log-dropped">
              Older ticks were dropped
            </li>
          )}
          {start > floor && (
            <li className={styles.logEmpty}>
              <button
                type="button"
                className={styles.link}
                onClick={() => setLimit(history.length)}
              >
                Show {start - floor} earlier ticks
              </button>
            </li>
          )}
          {groups.length === 0 && <li className={styles.logEmpty}>No log entries yet.</li>}
          {groups.map((index) => (
            <TickGroup
              key={index}
              index={index}
              tick={history[index]}
              passStart={index > 0 && history[index - 1].pass !== history[index].pass}
              root={root}
              project={project}
              depths={depths}
              ids={ids}
              overrides={propOverrides}
              showIds={showIds}
              expanded={overrides.get(index) ?? errorTicks.has(index)}
              current={index === viewIndex}
              future={index > viewIndex}
              breakpointHit={breakpointTicks.has(index)}
              kinds={kinds}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
