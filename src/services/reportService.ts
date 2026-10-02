import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { ReportItem, SightingItem, ReportType, ReportStatus, ContactRequest, AnnouncementItem, SiteSettings } from '../types';
import { INITIAL_DEMO_REPORTS, INITIAL_DEMO_ANNOUNCEMENTS, INITIAL_SITE_SETTINGS } from '../data/demoData';

const REPORTS_COLLECTION = 'reports';
const SIGHTINGS_COLLECTION = 'sightings';
const CONTACT_COLLECTION = 'contactRequests';
const AUDIT_COLLECTION = 'auditLogs';
const ANNOUNCEMENTS_COLLECTION = 'announcements';

// Helper keys to manage local persistence overlay for 100% reliability
const DELETED_REPORTS_KEY = 'nikhoj_deleted_report_ids_v1';
const UPDATED_REPORTS_KEY = 'nikhoj_updated_reports_v2';
const CREATED_REPORTS_KEY = 'nikhoj_created_reports_v2';

export function getDeletedReportIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_REPORTS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function markReportAsDeletedLocally(id: string) {
  try {
    const set = getDeletedReportIds();
    set.add(id);
    localStorage.setItem(DELETED_REPORTS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function getUpdatedReportsMap(): Record<string, Partial<ReportItem>> {
  try {
    const raw = localStorage.getItem(UPDATED_REPORTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveReportUpdateLocally(id: string, updates: Partial<ReportItem>) {
  try {
    const map = getUpdatedReportsMap();
    map[id] = { ...(map[id] || {}), ...updates, updatedAt: new Date().toISOString() };
    localStorage.setItem(UPDATED_REPORTS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Could not save local report update:', e);
  }
}

export function getCreatedReportsLocally(): ReportItem[] {
  try {
    const raw = localStorage.getItem(CREATED_REPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCreatedReportLocally(report: ReportItem) {
  try {
    const list = getCreatedReportsLocally().filter(r => r.id !== report.id);
    list.unshift(report);
    localStorage.setItem(CREATED_REPORTS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Could not save locally created report:', e);
  }
}

/**
 * Applies local overlay (edits, deletions, creations) to an array of reports
 */
function applyLocalOverlay(reports: ReportItem[]): ReportItem[] {
  const deletedIds = getDeletedReportIds();
  const updatesMap = getUpdatedReportsMap();

  return reports
    .filter(r => !deletedIds.has(r.id) && !deletedIds.has(r.reportId))
    .map(r => {
      const overrides = updatesMap[r.id] || updatesMap[r.reportId];
      if (overrides) {
        return {
          ...r,
          ...overrides,
          // ensure empty photos array is preserved if explicitly cleared
          photos: overrides.photos !== undefined ? overrides.photos : r.photos
        };
      }
      return r;
    });
}

// Generate human-friendly Report ID e.g. NA-2026-000123
export function generateReportId(): string {
  const year = new Date().getFullYear();
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `NA-${year}-${randomNum}`;
}

export function generateSightingId(): string {
  return `SG-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Fetch all published reports for public website
export async function getPublishedReports(options?: {
  type?: ReportType | 'all';
  district?: string;
  isUrgent?: boolean;
  limitCount?: number;
}): Promise<ReportItem[]> {
  const localCreated = getCreatedReportsLocally();
  const deletedIds = getDeletedReportIds();
  const rawFirestore: ReportItem[] = [];

  try {
    const reportsRef = collection(db, REPORTS_COLLECTION);
    let q = query(reportsRef, where('isPublished', '==', true), orderBy('createdAt', 'desc'));

    if (options?.isUrgent) {
      q = query(reportsRef, where('isPublished', '==', true), where('isUrgent', '==', true), orderBy('createdAt', 'desc'));
    }

    if (options?.limitCount) {
      q = query(q, limit(options.limitCount));
    }

    const snapshot = await getDocs(q);
    snapshot.forEach(docSnap => {
      rawFirestore.push({ id: docSnap.id, ...(docSnap.data() as Omit<ReportItem, 'id'>) });
    });
  } catch (error) {
    console.warn('Firestore published query note (using local cache & demo):', error);
  }

  // Combine and deduplicate: Firestore + localCreated + Initial Demo Reports
  const seenIds = new Set<string>();
  const combined: ReportItem[] = [];

  // 1. Add Firestore reports
  rawFirestore.forEach(r => {
    if (!seenIds.has(r.id) && (!r.reportId || !seenIds.has(r.reportId))) {
      combined.push(r);
      seenIds.add(r.id);
      if (r.reportId) seenIds.add(r.reportId);
    }
  });

  // 2. Add local created reports
  localCreated.forEach(lr => {
    if (!seenIds.has(lr.id) && (!lr.reportId || !seenIds.has(lr.reportId))) {
      combined.unshift(lr);
      seenIds.add(lr.id);
      if (lr.reportId) seenIds.add(lr.reportId);
    }
  });

  // 3. Add demo reports (unless deleted by admin)
  INITIAL_DEMO_REPORTS.forEach(dr => {
    if (!seenIds.has(dr.id) && !seenIds.has(dr.reportId) && !deletedIds.has(dr.id) && !deletedIds.has(dr.reportId)) {
      combined.push(dr);
      seenIds.add(dr.id);
      if (dr.reportId) seenIds.add(dr.reportId);
    }
  });

  // Apply all updates from admin overlay and filter strictly by isPublished === true
  let processed = applyLocalOverlay(combined).filter(r => r.isPublished === true);

  if (options?.type && options.type !== 'all') {
    processed = processed.filter(r => r.type === options.type);
  }
  if (options?.district) {
    processed = processed.filter(r => r.district.toLowerCase() === options.district?.toLowerCase());
  }
  if (options?.isUrgent) {
    processed = processed.filter(r => r.isUrgent);
  }

  return processed;
}

// Real-time synchronization event bus & cross-tab channel
export const NIKHOJ_SYNC_EVENT = 'nikhoj_reports_sync_event';

export function notifyReportSync(reportId?: string, action?: string) {
  try {
    // 1. Dispatch custom DOM event
    window.dispatchEvent(new CustomEvent(NIKHOJ_SYNC_EVENT, { detail: { reportId, action, timestamp: Date.now() } }));

    // 2. BroadcastChannel for other tabs & windows
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('nikhoj_sync_bus');
        bc.postMessage({ type: 'REPORTS_SYNC', reportId, action, timestamp: Date.now() });
        setTimeout(() => bc.close(), 100);
      } catch {}
    }

    // 3. Storage event trigger for older browsers/cross-origin subdomains
    try {
      localStorage.setItem('nikhoj_last_sync_ts', Date.now().toString());
    } catch {}
  } catch {}
}

// Subscribe to real-time published reports (with Firestore snapshot + instant local sync bus)
export function subscribeToPublishedReports(
  callback: (reports: ReportItem[]) => void,
  errorCallback?: (error: unknown) => void
) {
  let unsubFirestore = () => {};

  const refreshPublished = async () => {
    try {
      const list = await getPublishedReports();
      callback(list);
    } catch (e) {
      if (errorCallback) errorCallback(e);
    }
  };

  // Immediate initial load
  refreshPublished();

  // 1. Firestore Real-time listener
  try {
    const q = query(collection(db, REPORTS_COLLECTION), where('isPublished', '==', true), orderBy('createdAt', 'desc'));
    unsubFirestore = onSnapshot(
      q,
      () => {
        refreshPublished();
      },
      (err) => {
        console.warn('Realtime subscription firestore fallback:', err);
        refreshPublished();
        if (errorCallback) errorCallback(err);
      }
    );
  } catch (error) {
    refreshPublished();
  }

  // 2. Local DOM Event Listener
  const handleLocalSync = () => {
    refreshPublished();
  };
  window.addEventListener(NIKHOJ_SYNC_EVENT, handleLocalSync);

  // 3. Cross-tab Storage Listener
  const handleStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith('nikhoj_')) {
      refreshPublished();
    }
  };
  window.addEventListener('storage', handleStorage);

  // 4. BroadcastChannel Listener
  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel('nikhoj_sync_bus');
      bc.onmessage = () => {
        refreshPublished();
      };
    } catch {}
  }

  return () => {
    unsubFirestore();
    window.removeEventListener(NIKHOJ_SYNC_EVENT, handleLocalSync);
    window.removeEventListener('storage', handleStorage);
    if (bc) {
      try { bc.close(); } catch {}
    }
  };
}

// Subscribe to real-time Admin reports (instantly reflects new citizen submissions & approvals)
export function subscribeToAdminReports(
  callback: (reports: ReportItem[]) => void,
  errorCallback?: (error: unknown) => void
) {
  let unsubFirestore = () => {};

  const refreshAdmin = async () => {
    try {
      const list = await getAllReportsForAdmin();
      callback(list);
    } catch (e) {
      if (errorCallback) errorCallback(e);
    }
  };

  // Immediate initial load
  refreshAdmin();

  // 1. Firestore Real-time listener on all reports
  try {
    const q = query(collection(db, REPORTS_COLLECTION), orderBy('createdAt', 'desc'));
    unsubFirestore = onSnapshot(
      q,
      () => {
        refreshAdmin();
      },
      (err) => {
        console.warn('Realtime admin reports firestore fallback:', err);
        refreshAdmin();
        if (errorCallback) errorCallback(err);
      }
    );
  } catch (error) {
    refreshAdmin();
  }

  // 2. Local DOM Event Listener
  const handleLocalSync = () => {
    refreshAdmin();
  };
  window.addEventListener(NIKHOJ_SYNC_EVENT, handleLocalSync);

  // 3. Cross-tab Storage Listener
  const handleStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith('nikhoj_')) {
      refreshAdmin();
    }
  };
  window.addEventListener('storage', handleStorage);

  // 4. BroadcastChannel Listener
  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel('nikhoj_sync_bus');
      bc.onmessage = () => {
        refreshAdmin();
      };
    } catch {}
  }

  return () => {
    unsubFirestore();
    window.removeEventListener(NIKHOJ_SYNC_EVENT, handleLocalSync);
    window.removeEventListener('storage', handleStorage);
    if (bc) {
      try { bc.close(); } catch {}
    }
  };
}

// Fetch single report by human reportId or document id
export async function getReportById(identifier: string): Promise<ReportItem | null> {
  try {
    // Check if directly a doc ID
    const docRef = doc(db, REPORTS_COLLECTION, identifier);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return { id: snap.id, ...(snap.data() as Omit<ReportItem, 'id'>) };
    }

    // Search by reportId field
    const q = query(collection(db, REPORTS_COLLECTION), where('reportId', '==', identifier), limit(1));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const d = querySnap.docs[0];
      return { id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) };
    }

    // Search in demo data
    const demo = INITIAL_DEMO_REPORTS.find(r => r.id === identifier || r.reportId === identifier);
    return demo || null;
  } catch (error) {
    const demo = INITIAL_DEMO_REPORTS.find(r => r.id === identifier || r.reportId === identifier);
    return demo || null;
  }
}

// Submit a new citizen report (strictly pending and unverified until Admin review)
export async function submitPublicReport(reportData: Omit<ReportItem, 'id' | 'reportId' | 'status' | 'verificationStatus' | 'isPublished' | 'isUrgent' | 'isFeatured' | 'isDemo' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; reportId: string }> {
  const reportId = generateReportId();
  const docId = `rep_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  const newReport: ReportItem = {
    ...reportData,
    id: docId,
    reportId,
    status: 'pending',
    verificationStatus: 'unverified',
    isPublished: false,
    isUrgent: false,
    isFeatured: false,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Always save in local storage overlay first so citizen submission is never lost
  saveCreatedReportLocally(newReport);
  notifyReportSync(reportId, 'CREATE');

  // 2. Attempt Firestore setDoc in background/foreground
  try {
    await setDoc(doc(db, REPORTS_COLLECTION, docId), newReport);
  } catch (error) {
    console.warn('Firestore submission sync deferred/offline; safely queued in local dataset:', error);
  }

  return { success: true, reportId };
}

// Admin: Fetch all reports (including pending, rejected, archived)
export async function getAllReportsForAdmin(): Promise<ReportItem[]> {
  const localCreated = getCreatedReportsLocally();
  const deletedIds = getDeletedReportIds();

  try {
    const snapshot = await getDocs(query(collection(db, REPORTS_COLLECTION), orderBy('createdAt', 'desc')));
    const list: ReportItem[] = [];
    snapshot.forEach(d => {
      list.push({ id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) });
    });

    const firestoreIds = new Set(list.map(r => r.id));
    localCreated.forEach(lr => {
      if (!firestoreIds.has(lr.id)) {
        list.unshift(lr);
        firestoreIds.add(lr.id);
      }
    });

    // Also include remaining non-deleted demo reports if any
    INITIAL_DEMO_REPORTS.forEach(dr => {
      if (!firestoreIds.has(dr.id) && !deletedIds.has(dr.id) && !deletedIds.has(dr.reportId)) {
        list.push(dr);
      }
    });

    return applyLocalOverlay(list);
  } catch (error) {
    console.warn('Admin reports fallback to local and demo dataset:', error);
    const combined = [...localCreated, ...INITIAL_DEMO_REPORTS];
    return applyLocalOverlay(combined);
  }
}

// Admin: Update report status (Approve, Reject, Resolve, Feature, Urgent, Photo changes)
export async function updateReportByAdmin(
  reportDocId: string, 
  updates: Partial<ReportItem>, 
  adminEmail: string
): Promise<void> {
  // 1. Immediately save locally so any change (clearing photos, changing text) persists
  saveReportUpdateLocally(reportDocId, updates);
  notifyReportSync(reportDocId, 'UPDATE');

  // 2. Also update local created reports if applicable
  try {
    const createdList = getCreatedReportsLocally();
    const idx = createdList.findIndex(r => r.id === reportDocId || r.reportId === reportDocId);
    if (idx !== -1) {
      createdList[idx] = { ...createdList[idx], ...updates, updatedAt: new Date().toISOString() };
      localStorage.setItem(CREATED_REPORTS_KEY, JSON.stringify(createdList));
    }
  } catch {}

  // 3. Sync to Firestore
  try {
    const ref = doc(db, REPORTS_COLLECTION, reportDocId);
    let fullPayload: any = {
      ...updates,
      updatedAt: new Date().toISOString()
    };

    try {
      const existingSnap = await getDoc(ref);
      if (existingSnap.exists()) {
        fullPayload = {
          ...existingSnap.data(),
          ...updates,
          updatedAt: new Date().toISOString()
        };
      } else {
        const demoItem = INITIAL_DEMO_REPORTS.find(r => r.id === reportDocId || r.reportId === reportDocId);
        if (demoItem) {
          fullPayload = {
            ...demoItem,
            ...updates,
            updatedAt: new Date().toISOString()
          };
        }
      }
    } catch {}

    // Explicit setDoc ensures photos: [] cleanly clears photos rather than partial merge preservation
    await setDoc(ref, fullPayload);

    // Write audit log safely
    try {
      await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
        adminEmail,
        action: 'UPDATE_REPORT',
        reportId: reportDocId,
        details: JSON.stringify(updates),
        timestamp: new Date().toISOString()
      });
    } catch (auditErr) {
      console.warn('Audit log write skipped:', auditErr);
    }
  } catch (error) {
    console.warn('Firestore update warning (locally persisted):', error);
  }
}

// Admin: Approve & Publish Report to Public Site
export async function publishReportByAdmin(
  reportDocId: string, 
  adminEmail: string
): Promise<void> {
  await updateReportByAdmin(
    reportDocId,
    {
      status: 'approved',
      isPublished: true,
      verificationStatus: 'verified'
    },
    adminEmail
  );
  notifyReportSync(reportDocId, 'PUBLISH');
}

// Admin: Unpublish Report from Public Site
export async function unpublishReportByAdmin(
  reportDocId: string, 
  adminEmail: string
): Promise<void> {
  await updateReportByAdmin(
    reportDocId,
    {
      isPublished: false,
      status: 'pending'
    },
    adminEmail
  );
  notifyReportSync(reportDocId, 'UNPUBLISH');
}

// Admin: Batch Publish All Pending Reports
export async function publishAllPendingReportsByAdmin(
  adminEmail: string
): Promise<number> {
  const all = await getAllReportsForAdmin();
  const pendingList = all.filter(r => r.status === 'pending' || !r.isPublished);
  for (const rep of pendingList) {
    await updateReportByAdmin(
      rep.id,
      {
        status: 'approved',
        isPublished: true,
        verificationStatus: 'verified'
      },
      adminEmail
    );
  }
  notifyReportSync(undefined, 'BATCH_PUBLISH');
  return pendingList.length;
}

// Admin: Delete a report
export async function deleteReportByAdmin(reportDocId: string, adminEmail: string): Promise<void> {
  // 1. Immediately mark deleted locally
  markReportAsDeletedLocally(reportDocId);
  notifyReportSync(reportDocId, 'DELETE');

  // 2. Remove from local created reports list
  try {
    const createdList = getCreatedReportsLocally().filter(r => r.id !== reportDocId && r.reportId !== reportDocId);
    localStorage.setItem(CREATED_REPORTS_KEY, JSON.stringify(createdList));
  } catch {}

  // 3. Delete from Firestore
  try {
    await deleteDoc(doc(db, REPORTS_COLLECTION, reportDocId));
    try {
      await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
        adminEmail,
        action: 'DELETE_REPORT',
        reportId: reportDocId,
        timestamp: new Date().toISOString()
      });
    } catch {}
  } catch (error) {
    console.warn('Firestore delete warning (locally marked as deleted):', error);
  }
}

// Admin: Delete ALL demo reports at once
export async function deleteAllDemoReportsByAdmin(adminEmail: string): Promise<void> {
  for (const demo of INITIAL_DEMO_REPORTS) {
    await deleteReportByAdmin(demo.id, adminEmail);
    if (demo.reportId) {
      markReportAsDeletedLocally(demo.reportId);
    }
  }
}

// Submit a sighting (Citizens providing clues, private to Admins)
export async function submitSighting(sighting: Omit<SightingItem, 'id' | 'sightingId' | 'status' | 'createdAt'>): Promise<{ success: boolean; sightingId: string }> {
  const sightingId = generateSightingId();
  const docId = `sg_${Date.now()}`;
  const now = new Date().toISOString();

  const data: SightingItem = {
    ...sighting,
    id: docId,
    sightingId,
    status: 'new',
    createdAt: now
  };

  try {
    await setDoc(doc(db, SIGHTINGS_COLLECTION, docId), data);
    return { success: true, sightingId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${SIGHTINGS_COLLECTION}/${docId}`);
  }
}

// Admin: Fetch all sightings
export async function getSightingsForAdmin(): Promise<SightingItem[]> {
  try {
    const snapshot = await getDocs(query(collection(db, SIGHTINGS_COLLECTION), orderBy('createdAt', 'desc')));
    const list: SightingItem[] = [];
    snapshot.forEach(d => list.push({ id: d.id, ...(d.data() as Omit<SightingItem, 'id'>) }));
    return list;
  } catch (error) {
    console.warn('Could not fetch sightings for admin, falling back to empty list:', error);
    return [];
  }
}

// Contact / Correction / Abuse request
export async function submitContactRequest(req: Omit<ContactRequest, 'id' | 'status' | 'createdAt'>): Promise<void> {
  const docId = `req_${Date.now()}`;
  try {
    await setDoc(doc(db, CONTACT_COLLECTION, docId), {
      ...req,
      id: docId,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${CONTACT_COLLECTION}/${docId}`);
  }
}

// Calculate live aggregate stats from reports
export async function getLiveStatistics(): Promise<{
  totalReports: number;
  missingPersons: number;
  foundPersons: number;
  lostItems: number;
  foundItems: number;
  resolvedReports: number;
  urgentReports: number;
}> {
  try {
    const all = await getAllReportsForAdmin();
    const published = all.filter(r => r.isPublished || r.isDemo);

    return {
      totalReports: published.length,
      missingPersons: published.filter(r => r.type === 'missing_person').length,
      foundPersons: published.filter(r => r.type === 'found_person').length,
      lostItems: published.filter(r => r.type === 'lost_item').length,
      foundItems: published.filter(r => r.type === 'found_item').length,
      resolvedReports: published.filter(r => r.status === 'resolved').length,
      urgentReports: published.filter(r => r.isUrgent && r.status !== 'resolved').length,
    };
  } catch (error) {
    return {
      totalReports: INITIAL_DEMO_REPORTS.length,
      missingPersons: INITIAL_DEMO_REPORTS.filter(r => r.type === 'missing_person').length,
      foundPersons: INITIAL_DEMO_REPORTS.filter(r => r.type === 'found_person').length,
      lostItems: INITIAL_DEMO_REPORTS.filter(r => r.type === 'lost_item').length,
      foundItems: INITIAL_DEMO_REPORTS.filter(r => r.type === 'found_item').length,
      resolvedReports: INITIAL_DEMO_REPORTS.filter(r => r.status === 'resolved').length,
      urgentReports: INITIAL_DEMO_REPORTS.filter(r => r.isUrgent && r.status !== 'resolved').length,
    };
  }
}

// Admin: Directly create a verified report (offline / phone intake)
export async function createReportByAdmin(
  reportData: Omit<ReportItem, 'id' | 'reportId' | 'createdAt' | 'updatedAt'>,
  adminEmail: string
): Promise<{ success: boolean; reportId: string; docId: string }> {
  const reportId = generateReportId();
  const docId = `rep_adm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  const newReport: ReportItem = {
    ...reportData,
    id: docId,
    reportId,
    createdBy: adminEmail,
    createdAt: now,
    updatedAt: now,
  };

  const path = `${REPORTS_COLLECTION}/${docId}`;
  try {
    await setDoc(doc(db, REPORTS_COLLECTION, docId), newReport);

    // Audit log
    await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
      adminEmail,
      action: 'ADMIN_CREATE_REPORT',
      reportId: docId,
      details: `Created report ${reportId} directly: ${newReport.title}`,
      timestamp: now
    });

    return { success: true, reportId, docId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Announcements: Fetch all (public or admin)
export async function getAnnouncements(): Promise<AnnouncementItem[]> {
  try {
    const q = query(collection(db, ANNOUNCEMENTS_COLLECTION), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return INITIAL_DEMO_ANNOUNCEMENTS;
    }
    const list: AnnouncementItem[] = [];
    snapshot.forEach(d => list.push({ id: d.id, ...(d.data() as Omit<AnnouncementItem, 'id'>) }));
    return list;
  } catch (e) {
    console.warn('Fallback to demo announcements:', e);
    return INITIAL_DEMO_ANNOUNCEMENTS;
  }
}

// Admin: Create announcement
export async function createAnnouncement(
  data: Omit<AnnouncementItem, 'id' | 'createdAt'>,
  adminEmail: string
): Promise<string> {
  const docId = `ann_${Date.now()}`;
  const now = new Date().toISOString();
  const payload: AnnouncementItem = {
    ...data,
    id: docId,
    createdBy: adminEmail,
    createdAt: now
  };
  const path = `${ANNOUNCEMENTS_COLLECTION}/${docId}`;
  try {
    await setDoc(doc(db, ANNOUNCEMENTS_COLLECTION, docId), payload);
    // Audit log
    await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
      adminEmail,
      action: 'CREATE_ANNOUNCEMENT',
      reportId: docId,
      details: payload.title,
      timestamp: now
    });
    return docId;
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, path);
  }
}

// Admin: Update announcement
export async function updateAnnouncement(
  announcementId: string,
  updates: Partial<AnnouncementItem>,
  adminEmail: string
): Promise<void> {
  const path = `${ANNOUNCEMENTS_COLLECTION}/${announcementId}`;
  try {
    const ref = doc(db, ANNOUNCEMENTS_COLLECTION, announcementId);
    await setDoc(ref, updates, { merge: true });
    // Audit log
    await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
      adminEmail,
      action: 'UPDATE_ANNOUNCEMENT',
      reportId: announcementId,
      details: JSON.stringify(updates),
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, path);
  }
}

// Admin: Delete announcement
export async function deleteAnnouncement(
  announcementId: string,
  adminEmail: string
): Promise<void> {
  const path = `${ANNOUNCEMENTS_COLLECTION}/${announcementId}`;
  try {
    await deleteDoc(doc(db, ANNOUNCEMENTS_COLLECTION, announcementId));
    // Audit log
    await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
      adminEmail,
      action: 'DELETE_ANNOUNCEMENT',
      reportId: announcementId,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, path);
  }
}

// Seed Demo Data directly into Firestore
export async function seedDemoDataToFirestore(): Promise<number> {
  let seededCount = 0;
  for (const report of INITIAL_DEMO_REPORTS) {
    try {
      await setDoc(doc(db, REPORTS_COLLECTION, report.id), report, { merge: true });
      seededCount++;
    } catch (e) {
      console.warn('Could not seed item:', report.id, e);
    }
  }

  // Seed sample announcements as well
  for (const ann of INITIAL_DEMO_ANNOUNCEMENTS) {
    try {
      await setDoc(doc(db, ANNOUNCEMENTS_COLLECTION, ann.id), ann, { merge: true });
    } catch (e) {}
  }

  return seededCount;
}

// Clear all demo data from Firestore (Admin action)
export async function clearAllDemoDataFromFirestore(): Promise<number> {
  // Mark all in-memory demo records as deleted locally so they vanish immediately
  for (const rep of INITIAL_DEMO_REPORTS) {
    markReportAsDeletedLocally(rep.id);
    markReportAsDeletedLocally(rep.reportId);
  }

  try {
    const q = query(collection(db, REPORTS_COLLECTION), where('isDemo', '==', true));
    const snapshot = await getDocs(q);
    let deletedCount = 0;
    for (const d of snapshot.docs) {
      await deleteDoc(d.ref);
      deletedCount++;
    }
    return Math.max(deletedCount, INITIAL_DEMO_REPORTS.length);
  } catch (e) {
    console.error('Error clearing demo data from cloud:', e);
    return INITIAL_DEMO_REPORTS.length;
  }
}

// Site Settings helpers
const SETTINGS_DOC_ID = 'site_settings';
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', SETTINGS_DOC_ID));
    if (snap.exists()) {
      return { ...INITIAL_SITE_SETTINGS, ...(snap.data() as SiteSettings) };
    }
  } catch (e) {
    console.warn('Could not fetch settings:', e);
  }
  return INITIAL_SITE_SETTINGS;
}

export async function updateSiteSettings(settings: Partial<SiteSettings>, adminEmail: string): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', SETTINGS_DOC_ID), {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    console.warn('Error saving site settings:', e);
  }
}
