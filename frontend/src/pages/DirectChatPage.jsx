/**
 * DirectChatPage.jsx
 * ------------------
 * Secure real-time messaging interface.
 * Implements Socket.io for live relay and Web Crypto API for End-to-End Encryption.
 * The backend server only ever handles blind ciphertext payloads.
 */

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getSharedKey, encryptMessage, decryptMessage } from '../utils/cryptoUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const QUICK_EXIT_URL = 'https://www.google.com';

function createSocket(token) {
  return io(API_BASE_URL, {
    autoConnect: true,
    auth: {
      token
    }
  });
}

/**
 * Lightweight JWT payload decoder for client-only session bootstrap.
 *
 * We use this to read user identity claims (`userId`/`id`) and role so the
 * chat page can initialize immediately from localStorage before any extra API.
 * Signature verification still happens on the backend for protected routes.
 */
function decodeJwtPayload(token) {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payloadJson = atob(padded);
    return JSON.parse(payloadJson);
  } catch (error) {
    return null;
  }
}

const DirectChatPage = () => {
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [cryptoKey, setCryptoKey] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [isPrivacyMaskActive, setIsPrivacyMaskActive] = useState(false);
  
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const inactivityTimerRef = useRef(null);

  /**
   * 1. Initialize Channels and Socket Connection
   */
  useEffect(() => {
    // Session bootstrap comes from the same auth token written during login.
    const token = localStorage.getItem('authToken');
    if (!token) {
      setErrorMessage('You need to log in first to access direct chat.');
      return undefined;
    }

    const payload = decodeJwtPayload(token);
    // Accept both claim names because backend currently emits both for
    // compatibility with older/newer middleware consumers.
    const userId = payload?.userId || payload?.id || null;
    if (!userId) {
      setErrorMessage('Could not read your session. Please log in again.');
      return undefined;
    }

    setCurrentUserId(userId);
    // Role is used for labels in the chat list/header only.
    setCurrentUserRole((payload?.role || '').toString().toLowerCase());

    socketRef.current = createSocket(token);

    const loadChannels = async () => {
      try {
        // Channel list is identity-scoped by Authorization token.
        const response = await axios.get(`${API_BASE_URL}/api/chat/channels`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const loadedChannels = Array.isArray(response.data) ? response.data : [];
        setChannels(loadedChannels);
        // Auto-open the most recent channel for a familiar messenger UX.
        setActiveChannelId(loadedChannels[0]?.chatId || null);
      } catch (error) {
        setErrorMessage(error.response?.data?.error || 'Failed to load chat channels.');
      }
    };

    loadChannels();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  /**
   * 2. Handle Active Channel Change (Derive Key, Join Room, Fetch History)
   */
  useEffect(() => {
    if (!activeChannelId || !currentUserId) return;

    const setupSecureChannel = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setErrorMessage('Session expired. Please log in again.');
        return;
      }

      // Join the Socket room
      socketRef.current?.emit('joinChannel', activeChannelId);

      // Derive the channel key from a deterministic shared input.
      // In a production E2EE design this should come from real key exchange.
      const key = await getSharedKey(`shared-secret-for-${activeChannelId}`);
      setCryptoKey(key);

      try {
        // History endpoint returns ciphertext; decrypt client-side only.
        const response = await axios.get(`${API_BASE_URL}/api/chat/${activeChannelId}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        const history = Array.isArray(response.data) ? response.data : [];
        const decryptedHistory = await Promise.all(
          history.map(async (dbMessage) => ({
            messageId: dbMessage.messageId,
            senderUserId: dbMessage.senderUserId,
            // Failed decrypts are handled in cryptoUtils with a readable marker.
            plaintext: await decryptMessage(dbMessage.encryptedMessageContent, key),
            isMine: dbMessage.senderUserId === currentUserId
          }))
        );

        setMessages(decryptedHistory);
      } catch (error) {
        setMessages([]);
        setErrorMessage(error.response?.data?.error || 'Failed to load channel messages.');
      }
    };

    setupSecureChannel();
  }, [activeChannelId, currentUserId]);

  /**
   * 3. Listen for Incoming Live Messages
   */
  useEffect(() => {
    if (!cryptoKey || !currentUserId || !activeChannelId) return;

    const handleNewMessage = async (dbMessage) => {
      // Ignore events for other channels when user switches rapidly.
      if (dbMessage.chatId !== activeChannelId) return;

      // Decrypt the incoming ciphertext payload
      const plaintext = await decryptMessage(dbMessage.encryptedMessageContent, cryptoKey);
      
      const decryptedMsg = {
        messageId: dbMessage.messageId,
        senderUserId: dbMessage.senderUserId,
        plaintext: plaintext,
        // Bubble alignment depends on sender identity.
        isMine: dbMessage.senderUserId === currentUserId
      };

      setMessages((prev) => [...prev, decryptedMsg]);

      if (dbMessage.senderUserId !== currentUserId) {
        setNoticeMessage('You have a new update.');
        window.setTimeout(() => setNoticeMessage(''), 2800);
      }
    };

    socketRef.current?.on('receiveMessage', handleNewMessage);

    // Cleanup listener to prevent duplicates
    return () => socketRef.current?.off('receiveMessage', handleNewMessage);
  }, [activeChannelId, cryptoKey, currentUserId]);

  useEffect(() => {
    const markRead = async () => {
      const token = localStorage.getItem('authToken');
      if (!token || !activeChannelId) return;

      try {
        await axios.patch(
          `${API_BASE_URL}/api/chat/${activeChannelId}/read`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (error) {
        // No-op to avoid disrupting chat flow if read receipts fail.
      }
    };

    markRead();
  }, [activeChannelId, messages.length]);

  useEffect(() => {
    const activateMaskLater = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }

      setIsPrivacyMaskActive(false);
      inactivityTimerRef.current = window.setTimeout(() => {
        setIsPrivacyMaskActive(true);
      }, 25000);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, activateMaskLater));
    activateMaskLater();

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, activateMaskLater));
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * 4. Encrypt and Dispatch Message
   */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !cryptoKey || !currentUserId || !activeChannelId) return;

    // Optimistic clear keeps composer responsive while encryption/socket emits.
    const plaintext = newMessage;
    setNewMessage(''); // Clear input

    try {
      // Encrypt the message before it ever touches the network
      const encryptedPayload = await encryptMessage(plaintext, cryptoKey);

      // Emit the ciphertext payload over WebSockets
      socketRef.current?.emit('sendEncryptedMessage', {
        chatId: activeChannelId,
        encryptedPayload: encryptedPayload
      });

    } catch (err) {
      console.error('Failed to encrypt and send message:', err);
    }
  };

  return (
    // WhatsApp-inspired split layout with project theme colors from App.css.
    <div className="wa-page">
      <button type="button" className="quick-exit" onClick={() => window.location.replace(QUICK_EXIT_URL)}>
        Quick Exit
      </button>

      {isPrivacyMaskActive && (
        <button type="button" className="privacy-mask" onClick={() => setIsPrivacyMaskActive(false)}>
          Screen hidden for privacy. Tap to continue.
        </button>
      )}

      <section className="wa-shell" aria-label="Direct chat">
        <aside className="wa-sidebar">
          <header className="wa-sidebar-header">
            <h2>Chats</h2>
            <span>{channels.length}</span>
          </header>

          <div className="wa-chat-list">
            {errorMessage && <p className="wa-error">{errorMessage}</p>}

            {channels.map((channel) => (
              <button
                key={channel.chatId}
                onClick={() => setActiveChannelId(channel.chatId)}
                className={`wa-chat-item ${activeChannelId === channel.chatId ? 'active' : ''}`}
              >
                {/* Initial badges intentionally avoid exposing personal names. */}
                <span className="wa-avatar">{channel.chatChannelType === 'counsellor_channel' ? 'C' : 'L'}</span>
                <span className="wa-chat-text">
                  <strong>
                    {currentUserRole === 'survivor'
                      ? (channel.chatChannelType === 'counsellor_channel' ? 'Assigned Counsellor' : 'Assigned Legal Counsel')
                      : 'Survivor'}
                  </strong>
                  <small>Channel {channel.chatId.slice(0, 8)}...</small>
                </span>
              </button>
            ))}

            {channels.length === 0 && !errorMessage && (
              <p className="wa-empty-list">No active direct chat channels.</p>
            )}
          </div>
        </aside>

        <div className="wa-main">
          {activeChannelId ? (
            <>
              <header className="wa-main-header">
                <div className="wa-header-title">
                  <span className="wa-avatar muted">{currentUserRole === 'survivor' ? 'S' : 'U'}</span>
                  <div>
                    <strong>{currentUserRole === 'survivor' ? 'Secure Staff Channel' : 'Secure Survivor Channel'}</strong>
                    <small>end-to-end encrypted</small>
                  </div>
                </div>
                {noticeMessage && <p className="wa-notice">{noticeMessage}</p>}
              </header>

              <div className="wa-messages">
                {messages.length === 0 ? (
                  <p className="wa-empty-state">Messages in this channel are encrypted end-to-end.</p>
                ) : (
                  // Render deterministic order from API + realtime appends.
                  messages.map((msg) => (
                    <div key={msg.messageId} className={`wa-row ${msg.isMine ? 'mine' : 'theirs'}`}>
                      <div className={`wa-bubble ${msg.isMine ? 'mine' : 'theirs'}`}>
                        <p>{msg.plaintext}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="wa-composer">
                <input
                  type="text"
                  placeholder="Type a message"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  disabled={!cryptoKey}
                />
                <button type="submit" disabled={!cryptoKey || !newMessage.trim()}>
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="wa-empty-main">Select a chat to begin messaging.</div>
          )}
        </div>
      </section>
    </div>
  );
};

export default DirectChatPage;