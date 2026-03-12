// frontend/src/utils/api.js
/**
 * API helper functions - OIDC-Only Mode
 * Error handling and OIDC session-based authentication support
 */

// Base API URL - empty string for same-origin requests
const BASE_URL = '';

/**
 * Make an authenticated API request using OIDC session cookies
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  // Always include credentials for same-origin requests (OIDC session cookies)
  const isSameOrigin = url.startsWith(window.location.origin) || !url.startsWith('http');

  if (isSameOrigin) {
    options.credentials = 'include';
  }

  try {
    const response = await fetch(`${BASE_URL}${url}`, options);

    // Handle 401 responses - redirect to OIDC login
    if (response.status === 401 && isSameOrigin) {
      console.log('OIDC: Session expired or unauthorized, redirecting to OIDC login...');
      window.location.href = '/api/auth/oidc/login';
      throw new Error('Unauthorized - redirecting to OIDC login');
    }

    return response;
  } catch (error) {
    // Handle Service Worker registration error
    if (error.message?.includes('MIME type') && url.endsWith('/sw.js')) {
      console.warn('Service Worker not available. Safe to ignore in some environments.');
      throw error;
    }

    throw error;
  }
}

/**
 * Fetch summaries from API
 * @param {string} userFilter - 'all', 'mine', or 'favorites'
 * @returns {Promise<Array>}
 */
export async function fetchSummaries(userFilter = 'all') {
  let url = '/api/summaries';
  if (userFilter !== 'all') {
    url += `?userFilter=${userFilter}`;
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch summaries: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch favorites from API
 * @returns {Promise<Array>}
 */
export async function fetchFavorites() {
  const response = await apiFetch('/api/favorites');
  if (!response.ok) {
    throw new Error(`Failed to fetch favorites: ${response.status}`);
  }
  return response.json();
}

/**
 * Toggle favorite status
 * @param {string} summaryId - Summary ID
 * @param {string} sourceType - 'video', 'website', or 'custom'
 * @returns {Promise<object>}
 */
export async function toggleFavorite(summaryId, sourceType) {
  const response = await apiFetch('/api/favorites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ summaryId, sourceType })
  });

  if (!response.ok) {
    throw new Error(`Failed to toggle favorite: ${response.status}`);
  }
  return response.json();
}

/**
 * Remove favorite
 * @param {string} summaryId - Summary ID
 * @param {string} sourceType - 'video', 'website', or 'custom'
 * @returns {Promise<object>}
 */
export async function removeFavorite(summaryId, sourceType) {
  const response = await apiFetch('/api/favorites', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ summaryId, sourceType })
  });

  if (!response.ok) {
    throw new Error(`Failed to remove favorite: ${response.status}`);
  }
  return response.json();
}

/**
 * Check authentication status
 * @returns {Promise<object>}
 */
export async function checkAuthStatus() {
  const response = await apiFetch('/api/auth/verify');
  if (response.ok) {
    const data = await response.json();
    return {
      isAuthenticated: data.valid,
      user: data.user || null,
      authMethod: data.authMethod
    };
  }
  return { isAuthenticated: false, user: null, authMethod: null };
}

/**
 * Fetch app configuration
 * @returns {Promise<object>}
 */
export async function fetchAppConfig() {
  const response = await apiFetch('/api/config');
  if (!response.ok) {
    throw new Error(`Failed to fetch app config: ${response.status}`);
  }
  return response.json();
}

/**
 * Send chat message to arena (multiple summaries)
 * @param {string} prompt - Chat prompt/message
 * @param {Array<string>} summaryIds - Array of summary IDs to chat about
 * @param {AbortSignal} signal - Abort signal for stopping generation
 * @param {string} mode - Chat mode: 'cloud', 'publicai', or 'webgpu'
 * @returns {Promise<Response>}
 */
export async function sendArenaChatMessage(prompt, summaryIds, signal, mode = 'cloud') {
  const response = await apiFetch('/api/chat/ask-summaries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ summaryIds, prompt, mode }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Failed to send chat message: ${response.status}`);
  }

  return response;
}

/**
 * Request content summarization
 * @param {string} url - Content URL
 * @param {string} type - 'video' or 'website'
 * @returns {Promise<object>}
 */
export async function requestContent(url, type) {
  const response = await apiFetch('/api/grab', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, type })
  });

  if (!response.ok) {
    throw new Error(`Failed to request content: ${response.status}`);
  }
  return response.json();
}

/**
 * Submit custom content
 * @param {string} content - Custom content text
 * @param {string} title - Custom content title
 * @returns {Promise<object>}
 */
export async function submitCustomContent(content, title) {
  const response = await apiFetch('/api/grab/custom', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content, title })
  });

  if (!response.ok) {
    throw new Error(`Failed to submit custom content: ${response.status}`);
  }
  return response.json();
}
