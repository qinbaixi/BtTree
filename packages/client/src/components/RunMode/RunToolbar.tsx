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
import { t } from '../../i18n';

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
      <div className={styles.toolbar} role="toolbar" aria-label={t('Run controls')}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => run.play()}
          disabled={playing || pending !== undefined}
          title={finished ? t('Replay (F8)') : t('Play (F8)')}
        >
          <i className="fa-solid fa-play" aria-hidden="true" />
          {finished ? t('Replay') : t('Play')}
        </button>
        <button
          type="button"
          className={`${styles.pause} ${playing ? styles.pauseActive : ''}`}
          onClick={() => run.pause()}
          disabled={!playing}
          title={t('Pause (F8)')}
        >
          <i className="fa-solid fa-pause" aria-hidden="true" />
          {t('Pause')}
        </button>
        <button
          type="button"
          onClick={() => run.stepBack()}
          disabled={!canStepBack}
          title={t('Step back (Shift+F10)')}
        >
          <i className="fa-solid fa-backward-step" aria-hidden="true" />
          {t('Back')}
        </button>
        <button
          type="button"
          onClick={() => run.step()}
          disabled={finished || pending !== undefined}
          title={t('Step (F10)')}
        >
          <i className="fa-solid fa-forward-step" aria-hidden="true" />
          {t('Step')}
        </button>
        <button type="button" onClick={() => run.reset()} title={t('Reset')}>
          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
          {t('Reset')}
        </button>

        <label className={styles.speed}>
          {t('Speed')}
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.5}
            value={speed}
            onChange={(event) => run.setSpeed(Number(event.target.value))}
            aria-label={t('Speed in ticks per second')}
          />
          <span className={styles.speedValue}>{t('{speed} t/s', { speed })}</span>
        </label>

        <label
          className={styles.loops}
          title={t('Number of times the tree runs. 0 = loop forever.')}
        >
          {t('Loops')}
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
            aria-label={t('Loops')}
          />
        </label>

        <span className={styles.tick} data-testid="run-tick">
          {t('Tick {tick}', { tick: viewed?.tick ?? 0 })}
        </span>
        {pass && (
          <span className={styles.passInfo} data-testid="run-pass">
            {pass}
          </span>
        )}
        <span className={`${styles.status} ${STATUS_CLASS[status]}`} data-testid="run-status">
          {t(status)}
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
              {t('Succeed')}
            </button>
            <button
              type="button"
              className={styles.fail}
              onClick={() => run.resolveManual('failure')}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
              {t('Fail')}
            </button>
          </span>
        )}
      </div>
      {!live && (
        <div className={styles.banner} role="status">
          {t('Viewing tick {tick} of {last}', { tick: tickNumber, last: lastTick })}
          <button type="button" className={styles.link} onClick={() => run.backToLive()}>
            {t('back to live')}
          </button>
        </div>
      )}
    </div>
  );
}
