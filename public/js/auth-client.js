let _authCache = null;

async function getAuthContext(force = false) {
  if (_authCache && !force) return _authCache;

  const resp = await fetch('/api/auth/me', { method: 'GET' });
  if (!resp.ok) {
    _authCache = null;
    return null;
  }
  const data = await resp.json();
  _authCache = data;
  return _authCache;
}

async function authFetch(url, options = {}) {
  const ctx = await getAuthContext();
  if (!ctx) {
    window.location.href = '/login';
    throw new Error('Não autenticado');
  }

  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (method !== 'GET') {
    headers.set('x-csrf-token', ctx.csrfToken || '');
  }

  const resp = await fetch(url, { ...options, headers });

  if (resp.status === 401) {
    window.location.href = '/login';
    throw new Error('Sessão expirada');
  }
  return resp;
}

async function logoutAndRedirect() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  window.location.href = '/login';
}

window.AuthClient = { getAuthContext, authFetch, logoutAndRedirect };
