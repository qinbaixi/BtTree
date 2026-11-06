import { previewScore, type CompiledItemType } from '@owlbt/shared';
import { t } from '../../i18n';
import styles from './PropertyPanel.module.css';

const WIDTH = 220;
const HEIGHT = 90;
const PAD = { left: 26, right: 8, top: 8, bottom: 18 };

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Response curve of a score decorator: its score over the range of its blackboard input. */
export function ScorePreview({
  type,
  properties,
}: {
  type: CompiledItemType;
  properties: Record<string, unknown>;
}) {
  const preview = previewScore(type, properties);
  if (!preview || preview.points.length < 2) {
    return null;
  }
  const { min, max, points } = preview;
  const ys = points.map(([, y]) => y);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(1, ...ys);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - min) / (max - min)) * plotW;
  const sy = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;
  const path = points.map(([x, y]) => `${fmt(sx(x))},${fmt(sy(y))}`).join(' ');

  return (
    <fieldset className={styles.fieldset} data-score-preview>
      <legend>{t('Score curve')}</legend>
      <svg
        className={styles.scorePreview}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t('Score from {min} to {max} of the blackboard input', {
          min: fmt(min),
          max: fmt(max),
        })}
      >
        <line
          className={styles.scoreAxis}
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={PAD.left + plotW}
          y2={PAD.top + plotH}
        />
        <line
          className={styles.scoreAxis}
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + plotH}
        />
        <polyline className={styles.scoreLine} points={path} />
        <text className={styles.scoreLabel} x={PAD.left - 4} y={PAD.top + 4} textAnchor="end">
          {fmt(yMax)}
        </text>
        <text className={styles.scoreLabel} x={PAD.left - 4} y={PAD.top + plotH} textAnchor="end">
          {fmt(yMin)}
        </text>
        <text className={styles.scoreLabel} x={PAD.left} y={HEIGHT - 4} textAnchor="start">
          {fmt(min)}
        </text>
        <text className={styles.scoreLabel} x={PAD.left + plotW} y={HEIGHT - 4} textAnchor="end">
          {fmt(max)}
        </text>
      </svg>
      <p className={styles.scoreHint}>
        {t(
          'Horizontal: blackboard input (range from the Min / Max properties, else 0–1). Vertical: score.',
        )}
      </p>
    </fieldset>
  );
}
