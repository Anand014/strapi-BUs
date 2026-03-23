export type ReviewEntry = {
  contentType: string;
  title: string;
  adminUrl: string;
  action: 'Created' | 'Updated';
};

let syncActive = false;
let entriesMap = new Map<string, ReviewEntry>();

function getEntryKey(entry: ReviewEntry): string {
  return `${entry.contentType}:${entry.title.toLowerCase()}`;
}

export function startSync() {
  syncActive = true;
  entriesMap.clear();
}

export function endSync() {
  syncActive = false;
}

export function isSyncActive() {
  return syncActive;
}

export function addEntry(entry: ReviewEntry) {
  if (!syncActive) return;

  const key = getEntryKey(entry);
  entriesMap.set(key, entry);
}

export function getEntries(): ReviewEntry[] {
  return Array.from(entriesMap.values());
}

export function clearEntries() {
  entriesMap.clear();
}
