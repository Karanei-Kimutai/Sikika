/**
 * DirectChatPage.jsx
 * ------------------
 * Secure real-time messaging interface.
 * Implements Socket.io for live relay and Web Crypto API for End-to-End Encryption.
 * The backend server only ever handles blind ciphertext payloads.
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getToken } from '../utils/auth';
import { getSharedKey, encryptMessage, decryptMessage } from '../utils/cryptoUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Returns a human-readable presence label for a given availabilityStatus value.
 *
 * @param {string|null} value - The counterpartAvailability field from the channels API.
 * @returns {string}
 */
function presenceLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'AVAILABLE') return 'Online';
  if (normalized === 'BUSY') return 'Busy';
  if (normalized === 'OFFLINE') return 'Offline';
  return 'Unknown';
}

/**
 * Returns a CSS class name for the presence status dot.
 * Maps to .presence-dot--available / .presence-dot--busy / .presence-dot--offline
 * defined in App.css.
 *
 * @param {string|null} value
 * @returns {string}
 */
function presenceDotClass(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'AVAILABLE') return 'presence-dot presence-dot--available';
  if (normalized === 'BUSY') return 'presence-dot presence-dot--busy';
  return 'presence-dot presence-dot--offline';
}

/**
 * Renders the message delivery/seen tick suffix for outgoing messages.
 * Returns null when the message is not mine (ticks are sender-facing only).
 *
 * Tick semantics:
 *  seenAt      → ✓✓ Seen (double-tick, coloured)
 *  deliveredAt → ✓✓ Delivered (double-tick, grey)
 *  neither     → ✓ Sent (single-tick)
 *
 * @param {{ isMine: boolean, deliveredAt?: string|null, seenAt?: string|null }} msg
 * @returns {JSX.Element|null}
 */
function MessageTicks({ msg }) {
  if (!msg.isMine) return null;
  if (msg.seenAt) {
    return <span className="msg-ticks msg-ticks--seen" title={`Seen ${new Date(msg.seenAt).toLocaleTimeString()}`}>✓✓</span>;
  }
  if (msg.deliveredAt) {
    return <span className="msg-ticks msg-ticks--delivered" title={`Delivered ${new Date(msg.deliveredAt).toLocaleTimeString()}`}>✓✓</span>;
  }
  return <span className="msg-ticks msg-ticks--sent" title="Sent">✓</span>;
}

function createSocket(token) {
  return io(API_BASE_URL, {
    autoConnect: true,
    auth: {
      token
    }
  });
}

// Reads /chat?channel=<chatId> deep-link parameter when a preferred chat is provided.
function readPreferredChannelFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return String(params.get('channel') || '').trim();
  } catch {
    return '';
  }
}

// Writes the currently active channel back to URL and localStorage.
// This keeps direct-chat resume behavior consistent across page reload/navigation.
function persistPreferredChannel(channelId) {
  const value = String(channelId || '').trim();
  if (!value) return;

  localStorage.setItem('lastActiveDirectChatId', value);

  if (window.location.pathname !== '/chat') return;

  const params = new URLSearchParams(window.location.search);
  params.set('channel', value);
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', nextUrl);
}

// Socket auth token is attached during connection setup so backend can enforce
// per-channel authorization before room joins and sends.

function roleLabelFromSession(role) {
  return role === 'survivor' ? 'Survivor' : 'Counsellor';
}

function peerRoleLabelFromSession(role) {
  return role === 'survivor' ? 'Counsellor' : 'Survivor';
}

function buildDemoTranscript(currentRole) {
  const selfLabel = roleLabelFromSession(currentRole);
  const peerLabel = peerRoleLabelFromSession(currentRole);
  const isSurvivorView = currentRole === 'survivor';

  const turns = [
    { speaker: 'staff', text: 'Hi, thank you for reaching out today. Are you in a safe place to chat right now?' },
    { speaker: 'survivor', text: 'Yes, I am safe for now. I just feel overwhelmed and needed to talk to someone.' },
    { speaker: 'staff', text: 'I hear you. We can go step by step. What feels most urgent for you this evening?' },
    { speaker: 'survivor', text: 'I need a plan for tonight and maybe where to get help tomorrow morning.' },
    { speaker: 'staff', text: 'That makes sense. For tonight, can we identify one trusted person and one safe location?' },
    { speaker: 'survivor', text: 'I can stay with my cousin tonight. She knows part of what is happening.' },
    { speaker: 'staff', text: 'That is a strong step. Do you want me to share a short checklist you can follow before leaving?' },
    { speaker: 'survivor', text: 'Yes please. A checklist would help because my mind is racing.' },
    { speaker: 'staff', text: 'Checklist: phone charged, IDs, medicine, emergency contacts, and important documents if possible.' },
    { speaker: 'survivor', text: 'Got it. I can pack those in a small bag in ten minutes.' },
    { speaker: 'staff', text: 'Great. Tomorrow we can connect you to legal and psychosocial support based on your location.' },
    { speaker: 'survivor', text: 'Thank you. I also want to report, but I am scared of doing it wrong.' },
    { speaker: 'staff', text: 'You are not alone in that. We can complete the report together in simple steps when you are ready.' },
    { speaker: 'survivor', text: 'Okay. That helps. I feel calmer now and I can move to my cousin\'s place.' },
    { speaker: 'staff', text: 'You are doing well. Message me once you arrive, and we will continue from there.' },
    { speaker: 'survivor', text: 'I will. Thank you for staying with me through this.' }
  ];

  return turns.map((turn, index) => ({
    // Demo message ownership mirrors viewer role so staff never appears to send survivor lines.
    isMine: isSurvivorView ? turn.speaker === 'survivor' : turn.speaker === 'staff',
    messageId: `demo-${index + 1}`,
    senderUserId: (isSurvivorView ? turn.speaker === 'survivor' : turn.speaker === 'staff') ? 'demo-self' : 'demo-peer',
    plaintext: turn.text,
    senderLabel: (isSurvivorView ? turn.speaker === 'survivor' : turn.speaker === 'staff') ? selfLabel : peerLabel
  }));
}

// Demo transcript exists only to make local/dev screens easier to demo when
// channels have little or no real history.

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
  } catch {
    return null;
  }
}

const DirectChatPage = () => {
  const initialToken = getToken();
  const initialPayload = initialToken ? decodeJwtPayload(initialToken) : null;
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [cryptoKey, setCryptoKey] = useState(null);
  const [currentUserId] = useState(initialPayload?.userId || initialPayload?.id || null);
  const [currentUserRole] = useState((initialPayload?.role || '').toString().toLowerCase());
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [isPrivacyMaskActive, setIsPrivacyMaskActive] = useState(false);
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [menuChannelId, setMenuChannelId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const preferredChannelRef = useRef('');

  useEffect(() => {
    const handleOutsideMenuClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.wa-chat-item-actions')) return;
      if (target.closest('.wa-chat-options-menu')) return;
      setMenuChannelId(null);
    };

    window.addEventListener('mousedown', handleOutsideMenuClick);
    return () => window.removeEventListener('mousedown', handleOutsideMenuClick);
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuChannelId(null);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  /**
   * 1. Initialize Channels and Socket Connection
   */
  useEffect(() => {
    // Session bootstrap comes from the same auth token written during login.
    const token = getToken();
    if (!token) {
      const timerId = window.setTimeout(() => {
        setErrorMessage('You need to log in first to access direct chat.');
      }, 0);
      return () => window.clearTimeout(timerId);
    }

    if (!currentUserId) {
      const timerId = window.setTimeout(() => {
        setErrorMessage('Could not read your session. Please log in again.');
      }, 0);
      return () => window.clearTimeout(timerId);
    }

    preferredChannelRef.current = readPreferredChannelFromUrl() || String(localStorage.getItem('lastActiveDirectChatId') || '');

    socketRef.current = createSocket(token);

    const loadChannels = async () => {
      try {
        // Channel list is identity-scoped by Authorization token.
        const response = await axios.get(`${API_BASE_URL}/api/chat/channels`, {
          headers: { Authorization: `Bearer ${token}` },
          params: showArchivedChannels && currentUserRole === 'survivor' ? { includeArchived: true } : undefined
        });
        const loadedChannels = Array.isArray(response.data) ? response.data : [];
        setChannels(loadedChannels);

        // Selection strategy:
        // 1) URL deep-link channel from /chat?channel=...
        // 2) previously active channel persisted in localStorage
        // 3) fallback to most recent channel from API ordering
        const preferred = preferredChannelRef.current;
        const resolvedPreferred = loadedChannels.find((channel) => channel.chatId === preferred)?.chatId || null;
        const activeFallback = loadedChannels.find((channel) => channel.chatChannelStatus === 'active')?.chatId || null;
        setActiveChannelId(resolvedPreferred || activeFallback || loadedChannels[0]?.chatId || null);
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
  }, [showArchivedChannels, currentUserId, currentUserRole]);

  const activeChannel = channels.find((channel) => channel.chatId === activeChannelId) || null;
  const actionMenuChannel = channels.find((channel) => channel.chatId === menuChannelId) || null;

  const updateChannelStatus = async (chatId, status) => {
    if (!chatId) return;

    const token = getToken();
    if (!token) return;

    try {
      await axios.patch(
        `${API_BASE_URL}/api/chat/${chatId}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const refreshed = await axios.get(`${API_BASE_URL}/api/chat/channels`, {
        headers: { Authorization: `Bearer ${token}` },
        params: showArchivedChannels && currentUserRole === 'survivor' ? { includeArchived: true } : undefined
      });
      const loadedChannels = Array.isArray(refreshed.data) ? refreshed.data : [];
      setChannels(loadedChannels);
      setMenuChannelId(null);

      const nextActive = loadedChannels.find((channel) => channel.chatChannelStatus === 'active')?.chatId || loadedChannels[0]?.chatId || null;
      if (status === 'deleted' && activeChannelId === chatId) {
        setActiveChannelId(nextActive);
      } else if (!loadedChannels.some((channel) => channel.chatId === activeChannelId)) {
        setActiveChannelId(nextActive);
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.error || 'Failed to update chat channel status.');
    }
  };

  /**
   * 2. Handle Active Channel Change (Derive Key, Join Room, Fetch History)
   */
  useEffect(() => {
    if (!activeChannelId || !currentUserId) return;

    // Persisting here ensures both manual chat clicks and automatic opens are remembered.
    persistPreferredChannel(activeChannelId);

    const setupSecureChannel = async () => {
      const token = getToken();
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
            isMine: dbMessage.senderUserId === currentUserId,
            senderLabel:
              dbMessage.senderUserId === currentUserId
                ? roleLabelFromSession(currentUserRole)
                : peerRoleLabelFromSession(currentUserRole),
            // Carry delivery/seen timestamps so ticks render correctly on history load.
            deliveredAt: dbMessage.deliveredAt || null,
            seenAt: dbMessage.seenAt || null
          }))
        );

        const demoTranscriptEnabled = String(import.meta.env.VITE_ENABLE_CHAT_DEMO_TRANSCRIPT || '').toLowerCase() === 'true';
        const shouldAddDemoTranscript = import.meta.env.DEV && demoTranscriptEnabled && decryptedHistory.length < 8;
        // Demo transcript is now explicit opt-in to avoid confusing real user timelines.
        setMessages(
          shouldAddDemoTranscript
            ? [...decryptedHistory, ...buildDemoTranscript(currentUserRole)]
            : decryptedHistory
        );
      } catch (error) {
        setMessages([]);
        setErrorMessage(error.response?.data?.error || 'Failed to load channel messages.');
      }
    };

    setupSecureChannel();
  }, [activeChannelId, currentUserId, currentUserRole]);

  /**
   * 3. Listen for Incoming Live Messages
   */
  useEffect(() => {
    if (!cryptoKey || !currentUserId || !activeChannelId) return;

    // ── receiveMessage — new incoming or echoed outgoing message ──────────────
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
        isMine: dbMessage.senderUserId === currentUserId,
        senderLabel:
          dbMessage.senderUserId === currentUserId
            ? roleLabelFromSession(currentUserRole)
            : peerRoleLabelFromSession(currentUserRole),
        // Delivery/seen ticks — pre-populated if the counterpart was already online.
        deliveredAt: dbMessage.deliveredAt || null,
        seenAt: dbMessage.seenAt || null
      };

      setMessages((prev) => [...prev, decryptedMsg]);

      if (dbMessage.senderUserId !== currentUserId) {
        setNoticeMessage('You have a new update.');
        window.setTimeout(() => setNoticeMessage(''), 2800);
      }
    };

    // ── presence:update — staff came online or went offline ───────────────────
    const handlePresenceUpdate = ({ chatId, presence }) => {
      setChannels((prev) =>
        prev.map((ch) => {
          if (ch.chatId !== chatId) return ch;
          return {
            ...ch,
            counterpartAvailability: presence,
            asyncDeliveryHint:
              presence === 'OFFLINE'
                ? 'Your support worker is currently offline. Your messages will be delivered when they return.'
                : null
          };
        })
      );
    };

    // ── message:delivered — counterpart came back online and received pending messages ──
    const handleMessageDelivered = ({ chatId, messageIds, deliveredAt }) => {
      if (chatId !== activeChannelId) return;
      const idSet = new Set(messageIds);
      setMessages((prev) =>
        prev.map((m) => (idSet.has(m.messageId) && !m.deliveredAt ? { ...m, deliveredAt } : m))
      );
    };

    // ── message:seen — counterpart read the messages ──────────────────────────
    const handleMessageSeen = ({ chatId, messageIds, seenAt }) => {
      if (chatId !== activeChannelId) return;
      const idSet = new Set(messageIds);
      setMessages((prev) =>
        prev.map((m) => (idSet.has(m.messageId) && !m.seenAt ? { ...m, seenAt } : m))
      );
    };

    socketRef.current?.on('receiveMessage', handleNewMessage);
    socketRef.current?.on('presence:update', handlePresenceUpdate);
    socketRef.current?.on('message:delivered', handleMessageDelivered);
    socketRef.current?.on('message:seen', handleMessageSeen);

    // Cleanup listeners to prevent duplicates on re-register
    return () => {
      socketRef.current?.off('receiveMessage', handleNewMessage);
      socketRef.current?.off('presence:update', handlePresenceUpdate);
      socketRef.current?.off('message:delivered', handleMessageDelivered);
      socketRef.current?.off('message:seen', handleMessageSeen);
    };
  }, [activeChannelId, cryptoKey, currentUserId, currentUserRole]);

  useEffect(() => {
    const markRead = async () => {
      const token = getToken();
      if (!token || !activeChannelId) return;

      try {
        // Best-effort read receipt. Message rendering should not fail if this errors.
        await axios.patch(
          `${API_BASE_URL}/api/chat/${activeChannelId}/read`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
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

      // Any interaction reveals the screen and restarts inactivity countdown.
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
            {currentUserRole === 'survivor' && (
              <button type="button" className="link-btn" onClick={() => setShowArchivedChannels((value) => !value)}>
                {showArchivedChannels ? 'Hide Archived' : 'Show Archived'}
              </button>
            )}
          </header>

          <div className="wa-chat-list">
            {errorMessage && <p className="wa-error">{errorMessage}</p>}

            {channels.map((channel) => (
              <div key={channel.chatId} className={`wa-chat-item ${activeChannelId === channel.chatId ? 'active' : ''}`}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveChannelId(channel.chatId);
                    setMenuChannelId(null);
                  }}
                  className="wa-chat-open"
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
                    {/* Presence dot + label — only shown for survivor-side viewers where counterpartAvailability is populated */}
                    {currentUserRole === 'survivor' && channel.counterpartAvailability && (
                      <small className="wa-presence-row">
                        <span className={presenceDotClass(channel.counterpartAvailability)} aria-hidden="true" />
                        {presenceLabel(channel.counterpartAvailability)}
                        {channel.chatChannelStatus === 'archived' ? ' · Archived' : ''}
                      </small>
                    )}
                  </span>
                </button>

                {currentUserRole === 'survivor' && (
                  <div className="wa-chat-item-actions">
                    <button
                      type="button"
                      className="wa-chat-options-btn"
                      aria-expanded={menuChannelId === channel.chatId}
                      aria-label="Chat actions"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenuPosition({
                          top: rect.bottom + 6,
                          left: Math.max(12, rect.right - 180)
                        });
                        setMenuChannelId((value) => (value === channel.chatId ? null : channel.chatId));
                      }}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" focusable="false" />
                    </button>
                  </div>
                )}
              </div>
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
                    {activeChannel?.counterpartAvailability && (
                      <small className="wa-presence-row">
                        <span className={presenceDotClass(activeChannel.counterpartAvailability)} aria-hidden="true" />
                        {presenceLabel(activeChannel.counterpartAvailability)}
                      </small>
                    )}
                  </div>
                </div>
                {noticeMessage && <p className="wa-notice">{noticeMessage}</p>}
              </header>

              {activeChannel?.asyncDeliveryHint && <p role="alert" className="status-message warning">{activeChannel.asyncDeliveryHint}</p>}

              <div className="wa-messages">
                {messages.length === 0 ? (
                  <p className="wa-empty-state">Messages in this channel are encrypted end-to-end.</p>
                ) : (
                  // Render deterministic order from API + realtime appends.
                  messages.map((msg) => (
                    <div key={msg.messageId} className={`wa-row ${msg.isMine ? 'mine' : 'theirs'}`}>
                      <div className={`wa-bubble ${msg.isMine ? 'mine' : 'theirs'}`}>
                        <small className="wa-msg-role">{msg.senderLabel || (msg.isMine ? 'You' : 'Peer')}</small>
                        <p>{msg.plaintext}</p>
                        {/* Delivery/seen ticks — only rendered on sender's own bubbles */}
                        <MessageTicks msg={msg} />
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

      {menuChannelId && actionMenuChannel && createPortal(
        <div className="wa-chat-options-menu" style={{ top: menuPosition.top, left: menuPosition.left }}>
          {actionMenuChannel.chatChannelStatus === 'archived' ? (
            <button type="button" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'active')}>
              Restore Chat
            </button>
          ) : (
            <button type="button" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'archived')}>
              Archive Chat
            </button>
          )}
          <button type="button" className="danger" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'deleted')}>
            Delete Chat
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DirectChatPage;