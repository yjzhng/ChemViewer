import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Draggable left-panel width, persisted in localStorage. Returns the current
 * width plus an onMouseDown handler to attach to a resizer element between the
 * panel and the content.
 */
export function useResizablePanel(
  key: string,
  def = 240,
  min = 160,
  max = 480,
) {
  const clamp = (w: number) => Math.min(max, Math.max(min, w));
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v >= min && v <= max ? v : def;
    } catch {
      return def;
    }
  });

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(clamp(startW.current + (e.clientX - startX.current)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(key, String(widthRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, min, max]);

  const onMouseDown = (e: ReactMouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  return { width, onMouseDown };
}
