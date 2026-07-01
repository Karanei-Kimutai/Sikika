/**
 * Session storage utilities for auth tokens and user IDs
 * Uses sessionStorage (cleared on tab close) instead of localStorage (persistent)
 * for enhanced security on shared/surveilled devices.
 */

/** @returns {string|null} The stored JWT, or null when the session has no token. */
export const getToken = () => sessionStorage.getItem('authToken');

/**
 * Persists the JWT received from the auth API into sessionStorage.
 * @param {string} token - The raw JWT string.
 * @returns {void}
 */
export const setToken = (token) => sessionStorage.setItem('authToken', token);

/** Clears the stored JWT; call on sign-out and quick-exit. @returns {void} */
export const removeToken = () => sessionStorage.removeItem('authToken');

/** @returns {string|null} The stored UserAccount UUID, or null when not authenticated. */
export const getUserId = () => sessionStorage.getItem('userId');

/**
 * Persists the authenticated user's UUID alongside the JWT.
 * @param {string} id - UserAccount.userId from the JWT payload.
 * @returns {void}
 */
export const setUserId = (id) => sessionStorage.setItem('userId', id);

/** Clears the stored user ID; call on sign-out and quick-exit. @returns {void} */
export const removeUserId = () => sessionStorage.removeItem('userId');
