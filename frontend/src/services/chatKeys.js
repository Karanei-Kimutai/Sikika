/**
 * chatKeys.js — Frontend service for ECDH public-key exchange.
 *
 * Endpoints consumed:
 *   GET /api/chat/public-key/:userId — fetchPublicKey
 *   PUT /api/chat/public-key         — registerPublicKey
 */

import axios from 'axios';
import { getToken } from '../utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * @returns {{ Authorization: string }} Bearer auth header for the current session.
 */
function authHeaders() {
  const token = getToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Fetches another user's ECDH public key (JWK JSON string).
 *
 * @param {string} userId
 * @returns {Promise<string|null>} the JWK JSON string, or null if not registered yet
 */
export async function fetchPublicKey(userId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/chat/public-key/${userId}`,
      { headers: authHeaders() }
    );
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
  await axios.put(
    `${API_BASE_URL}/api/chat/public-key`,
    { ecdhPublicKey: ecdhPublicKeyJwk },
    { headers: authHeaders() }
  );
}
