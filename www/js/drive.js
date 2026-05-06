import { mergeDB } from './utils.js';
import { getAllRunRoutes, splitAndStoreRoutes } from './run-store.js';
import { getAuthToken, clearStoredToken, hasValidToken } from './auth/google.js';

// Google Drive backup/restore via REST API
// Auth is handled by native Google Sign-In (Capacitor) or GIS (web)

const BACKUP_FILENAME = 'arete-backup.json';

const SYNC_TS_KEY = 'areteLastSync';

function getLocalSyncTime() {
  return parseInt(localStorage.getItem(SYNC_TS_KEY)) || 0;
}

function setLocalSyncTime() {
  localStorage.setItem(SYNC_TS_KEY, Date.now().toString());
}

async function driveFetch(res, context) {
  if (res.ok) return res;
  if (res.status === 401) {
    clearStoredToken();
    throw new Error('token_expired');
  }
  throw new Error(`${context}: ${res.status}`);
}

async function findBackupFile(token) {
  const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,modifiedTime)',
    q: `name='${BACKUP_FILENAME}'`,
    pageSize: '1',
  });
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  await driveFetch(res, 'Error al buscar backup');
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function uploadFile(token, content, existingFileId) {
  const metadata = existingFileId
    ? { name: BACKUP_FILENAME }
    : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };

  const boundary = '---arete_boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  await driveFetch(res, 'Error al subir backup');
  return res.json();
}

async function downloadFile(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  await driveFetch(res, 'Error al descargar backup');
  return res.text();
}

/** Upload db to Google Drive appData folder (reconstructs full running logs from IDB) */
export async function backupToDrive(db) {
  const token = await getAuthToken();
  // Reconstruct full running logs with heavy fields from IndexedDB
  let fullDB = db;
  if (db.runningLogs?.length) {
    const routes = await getAllRunRoutes();
    if (routes.size > 0) {
      const fullLogs = db.runningLogs.map(l => {
        const heavy = routes.get(l.id);
        return heavy ? { ...l, ...heavy } : l;
      });
      fullDB = { ...db, runningLogs: fullLogs };
    }
  }
  const content = JSON.stringify(fullDB, null, 2);
  const existing = await findBackupFile(token);
  await uploadFile(token, content, existing ? existing.id : null);
  return { success: true, updated: !!existing };
}

/** Download and parse backup from Drive */
export async function restoreFromDrive() {
  const token = await getAuthToken();
  const file = await findBackupFile(token);
  if (!file) return { success: false, reason: 'no_backup' };
  const content = await downloadFile(token, file.id);
  let data;
  try { data = JSON.parse(content); } catch { throw new Error('Backup corrupto (JSON inválido)'); }
  if (!data.workouts) throw new Error('Formato de backup no valido');
  return { success: true, data, modifiedTime: file.modifiedTime };
}

// === Revision history (recovery) ===

/** List all Drive file revisions for version recovery */
export async function listRevisions() {
  const token = await getAuthToken();
  const file = await findBackupFile(token);
  if (!file) return { success: false, reason: 'no_backup' };
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}/revisions?fields=revisions(id,modifiedTime,size)`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  await driveFetch(res, 'Error al listar revisiones');
  const data = await res.json();
  return { success: true, fileId: file.id, revisions: data.revisions || [] };
}

/** Download and parse a specific Drive file revision */
export async function downloadRevision(fileId, revisionId) {
  const token = await getAuthToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${revisionId}?alt=media`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  await driveFetch(res, 'Error al descargar revisión');
  const content = await res.text();
  try { return JSON.parse(content); } catch { throw new Error('Revisión corrupta (JSON inválido)'); }
}

// === Auto-sync ===

let _syncing = false;
export function isSyncing() { return _syncing; }

/** Auto-backup to Drive without user interaction */
export async function silentBackup(db) {
  if (_syncing || !hasValidToken()) return;
  try {
    _syncing = true;
    await backupToDrive(db);
    setLocalSyncTime();
    setSyncStatus('ok');
  } catch (e) {
    console.warn('silentBackup failed:', e);
    setSyncStatus('error');
  } finally {
    _syncing = false;
  }
}

/** Sync local db with Drive on app load (merge if remote is newer) */
export async function syncOnLoad(db, saveFn) {
  if (!hasValidToken()) return;
  try {
    _syncing = true;
    setSyncStatus('syncing');
    const file = await findBackupFile(accessToken);
    if (!file) {
      _syncing = false;
      await silentBackup(db);
      return;
    }
    const driveTime = new Date(file.modifiedTime).getTime();
    const localTime = getLocalSyncTime();
    if (driveTime > localTime) {
      const content = await downloadFile(accessToken, file.id);
      let data;
      try { data = JSON.parse(content); } catch { console.warn('syncOnLoad: corrupt JSON from Drive'); _syncing = false; return; }
      if (data.workouts) {
        const merged = mergeDB(db, data);
        Object.assign(db, merged);
        // Split heavy route data from synced running logs to IndexedDB
        if (db.runningLogs?.length) {
          db.runningLogs = await splitAndStoreRoutes(db.runningLogs);
        }
        saveFn(db);
        setLocalSyncTime();
        setSyncStatus('ok');
        _syncing = false;
        await silentBackup(db);
        location.reload();
        return;
      }
    }
    _syncing = false;
    await silentBackup(db);
  } catch (e) {
    console.warn('syncOnLoad failed:', e);
    setSyncStatus('error');
    _syncing = false;
  }
}

let _syncStatusCb = null;
/** @param {Function} cb - Called with 'syncing' | 'ok' | 'error' */
export function onSyncStatus(cb) { _syncStatusCb = cb; }
function setSyncStatus(status) { if (_syncStatusCb) _syncStatusCb(status); }
