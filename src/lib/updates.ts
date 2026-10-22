import { create } from 'zustand';
import { toast } from '../store/toast';
import { desktop, UpdateState } from './desktop';

export const APP_VERSION = __APP_VERSION__;

/** Update status from the desktop app's updater (null in the browser). */
export const useUpdates = create<{ update: UpdateState | null; dismissed: string | null }>(() => ({
  update: null,
  dismissed: null,
}));

if (desktop?.updates) {
  desktop.updates.get().then((update) => useUpdates.setState({ update }));
  desktop.updates.onState((update) => useUpdates.setState({ update }));
}

export const checkForUpdates = () => desktop?.updates?.check();

/** Quits, installs the downloaded update and reopens MoviePlex. */
export async function installUpdate() {
  const result = await desktop?.updates?.install();
  if (result && !result.ok) toast(result.error ?? 'The update could not be installed', 'error');
}
