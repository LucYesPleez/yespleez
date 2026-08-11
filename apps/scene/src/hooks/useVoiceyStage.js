import { useCallback, useEffect, useState } from 'react';

/**
 * IS THE OVERSIZED VOICEY STAGE UP? — one preference, shared by every mount.
 *
 * The stage is raised by dragging the pill upward and lowered by dragging it
 * back down, and the same value is what a settings toggle will flip. So it
 * cannot live in one component's state: the composer that owns the gesture and
 * the settings row that owns the switch have to be looking at one fact.
 *
 * ⭐ A MODULE-LEVEL SUBSCRIBER LIST, NOT CONTEXT. Two mounts of the composer
 * never coexist today, but a settings screen and a composer do, and the value
 * has to survive one of them unmounting. Context would need a provider wrapped
 * around both — a change to the app shell for a boolean.
 *
 * ⚠ PREFERENCE ONLY — this says nothing about whether a recording is running.
 * The recorder's `phase` remains the sole authority on that (see Composer's
 * "MODE IS DERIVED, NEVER STORED"), and raising or lowering the stage must
 * never start, stop or discard a recording. A parked Voicey outlives it.
 */

const KEY = 'yp.voicey.stage';

const listeners = new Set();
let raised = read();

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode, or storage disabled. The stage simply starts down and the
    // gesture still works for the session — a thrown preference must not take
    // the composer with it.
    return false;
  }
}

export function setVoiceyStage(next) {
  const value = Boolean(next);
  if (value === raised) return;
  raised = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // Same reasoning as read(): remembering is a nicety, working is not.
  }
  for (const fn of listeners) fn(value);
}

export function isVoiceyStageRaised() {
  return raised;
}

export function useVoiceyStage() {
  const [value, setValue] = useState(raised);

  useEffect(() => {
    // Re-read on mount: another mount may have changed it between this
    // component's first render and its effects running.
    setValue(raised);
    listeners.add(setValue);
    return () => listeners.delete(setValue);
  }, []);

  return [value, useCallback(next => setVoiceyStage(next), [])];
}
