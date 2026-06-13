/**
 * Session storage utilities for auth tokens and user IDs
 * Uses sessionStorage (cleared on tab close) instead of localStorage (persistent)
 * for enhanced security on shared/surveilled devices.
 */

export const getToken = () => sessionStorage.getItem('authToken');
export const setToken = (token) => sessionStorage.setItem('authToken', token);
export const removeToken = () => sessionStorage.removeItem('authToken');

export const getUserId = () => sessionStorage.getItem('userId');
export const setUserId = (id) => sessionStorage.setItem('userId', id);
export const removeUserId = () => sessionStorage.removeItem('userId');
