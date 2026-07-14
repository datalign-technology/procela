import { useAuthStore } from '@/stores/authStore';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // Parsed JSON error body when the server returned one. Lets callers
    // read structured fields (validation details, requiresConfirmation,
    // etc.) instead of only the flattened message string.
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getAuthToken(): string | null {
  return useAuthStore.getState().accessToken;
}

function getRefreshToken(): string | null {
  return useAuthStore.getState().refreshToken;
}

// Track in-flight refresh to avoid concurrent refresh calls
let refreshPromise: Promise<void> | null = null;

async function ensureValidToken(): Promise<void> {
  const store = useAuthStore.getState();
  if (!store.isAuthenticated || !store.accessToken) return;

  const secondsRemaining = store.getTimeUntilExpiry();

  // If more than 2 minutes remain, no refresh needed
  if (secondsRemaining > 120) return;

  // If a refresh is already in-flight, wait for it
  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    // No refresh token available, force logout
    store.logout();
    window.location.href = '/login';
    return;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Refresh failed');
      }

      const result = await response.json();
      const { accessToken, expiresIn, refreshToken: rotatedRefresh } = result.data ?? result;

      // refreshToken on the response is the rotated value — store it
      // so subsequent /auth/refresh calls don't reuse the now-revoked
      // jti. Older backends that don't rotate omit the field; the
      // store keeps the existing value in that case.
      useAuthStore.getState().refreshSession(accessToken, expiresIn, rotatedRefresh);
    } catch {
      // Refresh failed, force logout
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // Skip token refresh for auth endpoints to avoid loops
  const isAuthEndpoint = path.startsWith('/auth/');
  if (!isAuthEndpoint) {
    await ensureValidToken();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message: string;
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(errorBody);
      const b = parsedBody as { message?: unknown; error?: unknown };
      const candidate = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : null;
      message = candidate ?? errorBody;
    } catch {
      message = errorBody || response.statusText;
    }
    throw new ApiError(response.status, message, parsedBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * Upload a file's raw bytes to `path`. The backend side pairs with
 * `express.raw()` and reads `?filename=` to name the stored file.
 * Content-Type is forced to application/octet-stream so the body is
 * delivered unchanged.
 */
async function uploadFile<T>(path: string, file: File): Promise<T> {
  await ensureValidToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${sep}filename=${encodeURIComponent(file.name)}`;

  const response = await fetch(url, { method: 'POST', headers, body: file });

  if (!response.ok) {
    const errorBody = await response.text();
    let message: string;
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(errorBody);
      const b = parsedBody as { message?: unknown; error?: unknown };
      const candidate = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : null;
      message = candidate ?? errorBody;
    } catch {
      message = errorBody || response.statusText;
    }
    throw new ApiError(response.status, message, parsedBody);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, file: File) => uploadFile<T>(path, file),
};
