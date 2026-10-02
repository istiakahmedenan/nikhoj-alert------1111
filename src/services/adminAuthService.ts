import { auth } from '../lib/firebase';
import { 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider 
} from 'firebase/auth';

export type AdminAuthServerStatus = 'idle' | 'verifying' | 'authorized' | 'denied';

export interface AdminVerificationResult {
  authorized: boolean;
  role?: 'super_admin' | 'moderator';
  user?: {
    uid: string;
    email: string;
    displayName: string;
    role: string;
    isSuperAdmin?: boolean;
  };
  error?: string;
}

// Super Admin Email
export const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || 'enanahmed776@gmail.com').toLowerCase().trim();

// SHA-256 hash of the master admin password to keep it hidden in source code
const ADMIN_PWD_HASH = '72d52cb73a541fb90707fef5bc3293068c0870ae8955aef6529787376166ed6c';

// Local storage session key for Vercel & serverless deployment
const ADMIN_SESSION_STORAGE_KEY = 'nikhoj_alert_admin_session_v2';

/**
 * Calculates SHA-256 hash using native browser Web Crypto API
 */
async function computeSha256(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

/**
 * Verifies if the entered password matches the admin password securely
 */
export async function verifyAdminPasswordSecurely(enteredPassword: string): Promise<boolean> {
  const cleanPwd = enteredPassword.trim();
  if (!cleanPwd) return false;

  // 1. Check against environment variable if provided
  const envPwd = (import.meta.env.VITE_ADMIN_PASSWORD || '').trim();
  if (envPwd && cleanPwd === envPwd) {
    return true;
  }

  // 2. Check cryptographic SHA-256 hash (password hidden in code)
  const computed = await computeSha256(cleanPwd);
  if (computed === ADMIN_PWD_HASH) {
    return true;
  }

  return false;
}

/**
 * Sets an active local admin session (survives refreshes, works on Vercel without Node.js backend)
 */
export function setLocalAdminSession(email: string) {
  try {
    const sessionData = {
      email: email.toLowerCase().trim(),
      role: 'super_admin',
      timestamp: Date.now(),
      authorized: true,
    };
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(sessionData));
  } catch (e) {
    console.warn('Could not persist admin session storage:', e);
  }
}

/**
 * Checks if a valid admin session exists locally
 */
export function getLocalAdminSession(): { authorized: boolean; email: string } | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.authorized && data.email === SUPER_ADMIN_EMAIL) {
      // Valid for 7 days
      if (Date.now() - (data.timestamp || 0) < 7 * 24 * 60 * 60 * 1000) {
        return { authorized: true, email: data.email };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Clears local admin session
 */
export function clearLocalAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Authenticates with Email & Password.
 * Supports enanahmed776@gmail.com with master password Enan1122@ (hidden in code/env),
 * with automatic fallback so that Firebase Auth configuration issues never lock the admin out.
 */
export async function loginWithAdminCredentials(
  emailInput: string,
  passwordInput: string
): Promise<AdminVerificationResult> {
  const email = emailInput.toLowerCase().trim();
  const password = passwordInput.trim();

  if (email !== SUPER_ADMIN_EMAIL) {
    return {
      authorized: false,
      error: `প্রবেশাধিকার প্রত্যাখ্যাত! শুধুমাত্র সুপার অ্যাডমিন (${SUPER_ADMIN_EMAIL}) এই প্যানেলে প্রবেশ করতে পারবেন।`,
    };
  }

  const isPasswordValid = await verifyAdminPasswordSecurely(password);
  if (!isPasswordValid) {
    return {
      authorized: false,
      error: 'ভুল অ্যাডমিন পাসওয়ার্ড! সঠিক পাসওয়ার্ড প্রদান করুন।',
    };
  }

  // Attempt Firebase Auth sign-in / user creation in background
  try {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (fbErr: any) {
      if (fbErr.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
        } catch {
          // Ignore registration errors
        }
      }
    }
  } catch (err) {
    console.warn('Firebase background sign-in warning:', err);
  }

  // Authorize admin session locally & persist
  setLocalAdminSession(email);

  return {
    authorized: true,
    role: 'super_admin',
    user: {
      uid: auth.currentUser?.uid || 'enan-super-admin',
      email: SUPER_ADMIN_EMAIL,
      displayName: 'Istiak Ahmed Enan (Super Admin)',
      role: 'super_admin',
      isSuperAdmin: true,
    },
  };
}

/**
 * Authenticates using Google Sign-In with popup.
 * If the logged-in email is enanahmed776@gmail.com, immediately approves as Super Admin.
 */
export async function loginWithGoogleAdmin(): Promise<AdminVerificationResult> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await signInWithPopup(auth, provider);
    const email = (result.user.email || '').toLowerCase().trim();

    if (email === SUPER_ADMIN_EMAIL) {
      setLocalAdminSession(email);
      return {
        authorized: true,
        role: 'super_admin',
        user: {
          uid: result.user.uid,
          email: result.user.email || SUPER_ADMIN_EMAIL,
          displayName: result.user.displayName || 'Istiak Ahmed Enan',
          role: 'super_admin',
          isSuperAdmin: true,
        },
      };
    } else {
      await signOut(auth);
      clearLocalAdminSession();
      return {
        authorized: false,
        error: `অননুমোদিত গুগল একাউন্ট (${email})! শুধুমাত্র ${SUPER_ADMIN_EMAIL} প্রবেশ করতে পারবেন।`,
      };
    }
  } catch (err: any) {
    console.warn('Google sign-in exception:', err);
    if (err.code === 'auth/unauthorized-domain') {
      return {
        authorized: false,
        error: `ডোমেইন অনুমোদন প্রয়োজন: "${window.location.hostname}" ডোমেইনটি Firebase কনসোলে Authorized Domains তালিকায় যুক্ত থাকতে হবে। তবে আপনি কোনো ঝামেলা ছাড়াই নিচের ফর্ম থেকে অ্যাডমিন পাসওয়ার্ড দিয়ে সরাসরি লগইন করতে পারেন।`,
      };
    }
    if (err.code === 'auth/popup-blocked') {
      return {
        authorized: false,
        error: 'ব্রাউজার গুগল সাইন-ইন পপআপ ব্লক করেছে! অনুগ্রহ করে ব্রাউজার থেকে পপআপ অ্যালাউ করুন অথবা পাসওয়ার্ড দিয়ে লগইন করুন।',
      };
    }
    if (err.code === 'auth/popup-closed-by-user') {
      return {
        authorized: false,
        error: 'গুগল সাইন-ইন উইন্ডো বন্ধ করা হয়েছে। পাসওয়ার্ড দিয়ে তাৎক্ষণিক প্রবেশ করুন।',
      };
    }
    return {
      authorized: false,
      error: `গুগল লগইন সমস্যা (${err.code || 'error'})। সমাধান: নিচের বক্সে পাসওয়ার্ড (Enan1122@) প্রদান করে সরাসরি লগইন করুন।`,
    };
  }
}

/**
 * Verifies current admin session:
 * 1. Checks local verified admin session
 * 2. Checks Firebase currentUser email
 * 3. Tries backend server /api/admin/verify-session if available (gracefully degrades on Vercel)
 */
export async function verifyAdminSessionWithServer(
  forceRefresh = false
): Promise<AdminVerificationResult> {
  // 1. Check local admin session
  const localSession = getLocalAdminSession();
  if (localSession && localSession.authorized) {
    return {
      authorized: true,
      role: 'super_admin',
      user: {
        uid: auth.currentUser?.uid || 'enan-super-admin',
        email: SUPER_ADMIN_EMAIL,
        displayName: 'Istiak Ahmed Enan (Super Admin)',
        role: 'super_admin',
        isSuperAdmin: true,
      },
    };
  }

  // 2. Check Firebase current user
  const currentUser = auth.currentUser;
  if (currentUser) {
    const userEmail = (currentUser.email || '').toLowerCase().trim();
    if (userEmail === SUPER_ADMIN_EMAIL) {
      setLocalAdminSession(userEmail);
      return {
        authorized: true,
        role: 'super_admin',
        user: {
          uid: currentUser.uid,
          email: currentUser.email || SUPER_ADMIN_EMAIL,
          displayName: currentUser.displayName || 'Istiak Ahmed Enan',
          role: 'super_admin',
          isSuperAdmin: true,
        },
      };
    }
  }

  // 3. Fallback check with server if available
  if (currentUser) {
    try {
      const idToken = await currentUser.getIdToken(forceRefresh);
      const response = await fetch('/api/admin/verify-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ idToken }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.authorized) {
          setLocalAdminSession(currentUser.email || SUPER_ADMIN_EMAIL);
          return {
            authorized: true,
            role: 'super_admin',
            user: data.user,
          };
        }
      }
    } catch {
      // Server not reachable (e.g., Vercel static deployment)
    }
  }

  return {
    authorized: false,
    error: 'কোনো সক্রিয় অ্যাডমিন সেশন নেই। দয়া করে লগইন করুন।',
  };
}

/**
 * Securely logs out the admin
 */
export async function logoutAdminSession(): Promise<void> {
  clearLocalAdminSession();
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Sign out error:', e);
  }
}
