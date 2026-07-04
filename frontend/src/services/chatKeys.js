/**
 * chatKeys.js — Frontend service for ECDH public-key exchange.
 *
 * Endpoints consumed:
 *   GET /api/chat/public-key/:userId — fetchPublicKey
 *   PUT /api/chat/public-key         — registerPublicKey
 */

import apiClient from './apiClient';

/**
 * Fetches another user's ECDH public key (JWK JSON string).
 *
 * @param {string} userId
 * @returns {Promise<string|null>} the JWK JSON string, or null if not registered yet
 */
export async function fetchPublicKey(userId) {
  try {
    const response = await apiClient.get(`/api/chat/public-key/${userId}`);
    return response.data?.ecdhPublicKey || null;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Registers or refreshes the authenticated user's ECDH public key on the server.
 * Idempotent — safe to call on every app load (App.jsx does exactly this).
 * Once registered, counterparts can derive a shared AES-GCM chat key.
 *
 * @param {string} ecdhPublicKeyJwk - Exported JWK JSON string from `exportPublicKeyJwk`.
 * @returns {Promise<void>}
 */
export async function registerPublicKey(ecdhPublicKeyJwk) {
  await apiClient.put('/api/chat/public-key', { ecdhPublicKey: ecdhPublicKeyJwk });
}
