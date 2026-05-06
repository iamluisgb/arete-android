const CLIENT_ID = '146475241021-2sschmrutnqdeug5fo6onc772im94ltt.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let _initialized = false;
let _accessToken = null;
let _tokenExpiry = 0;

const TOKEN_KEY = 'areteToken';
const EXPIRY_KEY = 'areteTokenExpiry';

function persistToken() {
  try {
    localStorage.setItem(TOKEN_KEY, _accessToken);
    localStorage.setItem(EXPIRY_KEY, _tokenExpiry.toString());
  } catch (e) { /* ignore */ }
}

function restoreToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    const e = parseInt(localStorage.getItem(EXPIRY_KEY)) || 0;
    if (t && Date.now() < e) {
      _accessToken = t;
      _tokenExpiry = e;
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
    }
  } catch (e) { /* ignore */ }
}

export async function initAuth() {
  if (_initialized) return;
  restoreToken();
  try {
    // Dynamic import — only works in Capacitor native
    const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in');
    await GoogleSignIn.initialize({
      clientId: CLIENT_ID,
      scopes: [SCOPE],
    });
    _initialized = true;
  } catch (e) {
    // Not in Capacitor — nothing to do
    console.warn('Google Sign-In not available (not in Capacitor):', e.message);
  }
}

export function hasValidToken() {
  return _accessToken && Date.now() < _tokenExpiry;
}

export async function getAuthToken() {
  if (hasValidToken()) {
    return _accessToken;
  }
  try {
    const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in');
    const result = await GoogleSignIn.signIn();
    if (result.accessToken) {
      _accessToken = result.accessToken;
      _tokenExpiry = Date.now() + 3540000;
      persistToken();
      return _accessToken;
    }
    throw new Error('No access token received');
  } catch (e) {
    throw new Error(e.message || 'Error al iniciar sesión con Google');
  }
}

export function clearStoredToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}
