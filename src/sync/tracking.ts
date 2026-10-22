// Store changes made by the sync engine itself (applying remote data) or by switching
// profiles must not be recorded as local edits, or they'd be pushed back as "newer".

let depth = 0;

export function untracked<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

export const isTracking = () => depth === 0;
