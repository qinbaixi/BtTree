import { useState } from 'react';
import { useTreeStore } from '../../store/treeStore';
import {
  clampLoops,
  MAX_SPEED,
  MIN_SPEED,
  runStore,
  selectCanStepBack,
  selectIsLive,
  selectViewed,
  useRunStore,
} from '../../store/runStore';
import { finishedLabel, nodeDisplayName, passLabel, statusLabel } from './runHelpers';
import styles from './RunMode.module.css';

const STATUS_CLASS: Record<ReturnType<typeof statusLabel>, string> = {
  Ready: styles.statusReady,
  Running: styles.statusRunning,
  Success: styles.statusSuccess,
  Failure: styles.statusFailure,
  'Waiting for manual result': styles.statusWaiting,
};

/** Controls of run mode, shown under the breadcrumb. */
export default function RunToolbar() {
  const playing = useRunStore((state) => state.playing);
  const speed = useRunStore((state) => state.speed);
  const viewed = useRunStore(selectViewed);
  const live = useRunStore(selectIsLive);
  const loops = useRunStore((state) => state.loops);
  const canStepBack = useRunStore(selectCanStepBack);
  const tickNumber = useRunStore((state) => state.history[state.viewIndex]?.tick ?? 0);
  const lastTick = useRunStore((state) => state.history[state.history.length - 1]?.tick ?? 0);
  const treeRoot = useTreeStore((state) => state.root);
  const runRoot = useRunStore((state) => state.runRoot);
  // The pending node may be in a referenced tree: names come from the tree that runs.
  const root = runRoot ?? treeRoot;

  const run = runStore.getState();
  const latest = useRunStore((state) => state.history[state.history.length - 1]);
  const finished = latest?.finished !== undefined;
  const pending = latest?.pendingManual;
  const status = statusLabel(viewed);
  const pass = passLabel(viewed);
  const done = finishedLabel(viewed);
  const [loopsText, setLoopsText] = useState<string>();

  return (
    <div className={styles.toolbarWrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Run controls">
        <button
          type="button"
          className={styles.primary}
          onClick={() => run.play()}
          disabled={playing || pending !== undefined}
          title={finished ? 'Replay (F8)' : 'Play (F8)'}
        >
          <i className="fa-solid fa-play" aria-hidden="true" />
          {finished ? 'Replay' : 'Play'}
        </button>
        <button
          type="button"
          className={`${styles.pause} ${playing ? styles.pauseActive : ''}`}
          onClick={() => run.pause()}
          disabled={!playing}
          title="Pause (F8)"
        >
          <i className="fa-solid fa-pause" aria-hidden="true" />
          Pause
        </button>
        <button
          type="button"
          onClick={() => run.stepBack()}
          disabled={!canStepBack}
          title="Step back (Shift+F10)"
        >
          <i className="fa-solid fa-backward-step" aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          onClick={() => run.step()}
          disabled={finished || pending !== undefined}
          title="Step (F10)"
        >
          <i className="fa-solid fa-forward-step" aria-hidden="true" />
          Step
        </button>
        <button type="button" onClick={() => run.reset()} title="Reset">
          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
          Reset
        </button>

        <label className={styles.speed}>
          Speed
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.5}
            value={speed}
            onChange={(event) => run.setSpeed(Number(event.target.value))}
            aria-label="Speed in ticks per second"
          />
          <span className={styles.speedValue}>{speed} t/s</span>
        </label>

        <label className={styles.loops} title="Number of times the tree runs. 0 = loop forever.">
          Loops
          <input
            type="number"
            className={styles.loopsInput}
            min={0}
            step={1}
            value={loopsText ?? String(loops)}
            onChange={(event) => {
              const text = event.target.value;
              setLoopsText(text);
              // Only complete values apply while typing; the rest is clamped on blur.
              if (/^\d+$/.test(text.trim())) {
                run.setLoops(Number(text));
              }
            }}
            onBlur={() => {
              if (loopsText !== undefined) {
                const text = loopsText;
                const value = clampLoops(text.trim() === '' ? 1 : Number(text));
                run.setLoops(value);
                setLoopsText(undefined);
              }
            }}
            aria-label="Loops"
          />
        </label>

        <span className={styles.tick} data-testid="run-tick">
          Tick {viewed?.tick ?? 0}
        </span>
        {pass && (
          <span className={styles.passInfo} data-testid="run-pass">
            {pass}
          </span>
        )}
        <span className={`${styles.status} ${STATUS_CLASS[status]}`} data-testid="run-status">
          {status}
        </span>
        {done && (
          <span className={styles.passInfo} data-testid="run-finished">
            {done}
          </span>
        )}

        {pending !== undefined && live && (
          <span className={styles.manual}>
            <span className={styles.manualName}>{nodeDisplayName(root, pending)}</span>
            <button
              type="button"
              className={styles.succeed}
              onClick={() => run.resolveManual('success')}
            >
              <i className="fa-solid fa-check" aria-hidden="true" />
              Succeed
            </button>
            <button
              type="button"
              className={styles.fail}
              onClick={() => run.resolveManual('failure')}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
              Fail
            </button>
          </span>
        )}
      </div>
      {!live && (
        <div className={styles.banner} role="status">
          Viewing tick {tickNumber} of {lastTick}
          <button type="button" className={styles.link} onClick={() => run.backToLive()}>
            back to live
          </button>
        </div>
      )}
    </div>
  );
}
