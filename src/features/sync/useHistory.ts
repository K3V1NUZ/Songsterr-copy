// Undo/redo for a value, with live "preview" changes (while dragging) that are
// committed as one history step when the drag ends.
import { useCallback, useState } from 'react';

const LIMIT = 100;

export interface History<T> {
  value: T;
  /** True once the user changed something (used to skip autosave on open). */
  touched: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Replace the value as a new undo step. */
  set: (v: T) => void;
  /** Show a value without creating an undo step yet (during a drag). */
  preview: (v: T) => void;
  /** Turn the current preview into an undo step. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  /** Start over from a value (clears history). */
  reset: (v: T) => void;
}

interface State<T> { past: T[]; present: T; future: T[]; committed: T; touched: boolean }

export function useHistory<T>(initial: T): History<T> {
  const [s, setS] = useState<State<T>>({ past: [], present: initial, future: [], committed: initial, touched: false });
  const set = useCallback((v: T) => setS((st) => ({ past: [...st.past, st.committed].slice(-LIMIT), present: v, future: [], committed: v, touched: true })), []);
  const preview = useCallback((v: T) => setS((st) => ({ ...st, present: v, touched: true })), []);
  const commit = useCallback(() => setS((st) => (st.present === st.committed ? st : { past: [...st.past, st.committed].slice(-LIMIT), present: st.present, future: [], committed: st.present, touched: true })), []);
  const undo = useCallback(() => setS((st) => {
    const prev = st.past[st.past.length - 1];
    return prev === undefined ? st : { past: st.past.slice(0, -1), present: prev, future: [st.committed, ...st.future], committed: prev, touched: true };
  }), []);
  const redo = useCallback(() => setS((st) => {
    const next = st.future[0];
    return next === undefined ? st : { past: [...st.past, st.committed], present: next, future: st.future.slice(1), committed: next, touched: true };
  }), []);
  const reset = useCallback((v: T) => setS({ past: [], present: v, future: [], committed: v, touched: false }), []);
  return { value: s.present, touched: s.touched, canUndo: s.past.length > 0, canRedo: s.future.length > 0, set, preview, commit, undo, redo, reset };
}
