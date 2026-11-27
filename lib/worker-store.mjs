import { refreshSnapshot, staleSnapshot } from './snapshot.mjs';
import { createUpstream } from './upstream.mjs';

const snapshotKey = 'dining-v1';
const maxSnapshotAge = 65 * 60 * 1000;

export async function getWorkerDiningData(kv, now = Date.now()) {
  const snapshot = await kv.get(snapshotKey, 'json');
  if (snapshot?.version !== 1 || !snapshot.data) throw new Error('Dining snapshot is unavailable');
  const { data } = snapshot;
  if (now - Date.parse(data.checkedAt) > maxSnapshotAge) {
    return staleSnapshot(data, 'Scheduled refresh is overdue');
  }
  return data;
}

export async function refreshWorkerDiningData(kv, beginRun = createUpstream()) {
  const previous = await kv.get(snapshotKey, 'json');
  const snapshot = await refreshSnapshot(beginRun, previous?.version === 1 ? previous.sources : undefined);
  await kv.put(snapshotKey, JSON.stringify(snapshot));
  return { locations: snapshot.data.count, issues: snapshot.data.issues };
}
