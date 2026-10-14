import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getJson, setJson } from '../../lib/storage';
import { t } from '../../i18n';
import styles from './ProjectEditor.module.css';

export const PREVIEW_WIDTH_STORAGE_KEY = 'owlbt.previewWidth';
export const PREVIEW_MIN_WIDTH = 260;
export const PREVIEW_MAX_WIDTH = 900;
export const PREVIEW_DEFAULT_WIDTH = 360;

export function clampPreviewWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return PREVIEW_DEFAULT_WIDTH;
  }
  return Math.round(Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, width)));
}

/** Width of the preview panel, persisted in localStorage. */
export function usePreviewWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() =>
    clampPreviewWidth(getJson<number>(PREVIEW_WIDTH_STORAGE_KEY, PREVIEW_DEFAULT_WIDTH)),
  );
  const update = (next: number) => {
    const clamped = clampPreviewWidth(next);
    setWidth(clamped);
    setJson(PREVIEW_WIDTH_STORAGE_KEY, clamped);
  };
  return [width, update];
}

interface PanelResizerProps {
  /** Current size (px) of the panel: its width for a vertical handle, its height for a horizontal one. */
  value: number;
  onResize(value: number): void;
  /** Vertical = handle on the left edge of a panel (col-resize), horizontal = on its top edge. */
  orientation?: 'vertical' | 'horizontal';
  min?: number;
  max?: number;
  defaultValue?: number;
  label?: string;
  title?: string;
}

const KEY_STEP = 20;

/**
 * Drag handle on one edge of a panel. Vertical: on the left edge, dragging left grows the panel and
 * ArrowLeft / ArrowRight resize in 20px steps. Horizontal: on the top edge, dragging up grows the
 * panel and ArrowUp / ArrowDown resize in 20px steps. Double click restores the default size.
 */
export function PanelResizer({
  value,
  onResize,
  orientation = 'vertical',
  min = PREVIEW_MIN_WIDTH,
  max = PREVIEW_MAX_WIDTH,
  defaultValue = PREVIEW_DEFAULT_WIDTH,
  label = t('Resize preview'),
  title = t('Drag to resize the preview'),
}: PanelResizerProps) {
  const [dragging, setDragging] = useState(false);
  const horizontal = orientation === 'horizontal';

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = horizontal ? event.clientY : event.clientX;
    const startValue = value;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const now = horizontal ? moveEvent.clientY : moveEvent.clientX;
      onResize(startValue + (start - now));
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const shrink = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (event.key === grow) {
      event.preventDefault();
      onResize(value + KEY_STEP);
    } else if (event.key === shrink) {
      event.preventDefault();
      onResize(value - KEY_STEP);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={title}
      className={`${horizontal ? styles.resizerHorizontal : styles.resizer} ${
        dragging ? styles.resizerActive : ''
      }`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(defaultValue)}
    />
  );
}
