/**
 * DirectChatPage.jsx
 * ------------------
 * Secure real-time messaging interface.
 * Implements Socket.io for live relay and Web Crypto API for End-to-End Encryption.
 * The backend server only ever handles blind ciphertext payloads.
 */

import { useState, useEffect, useRef, useReducer, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ArrowLeft, MoreHorizontal, Send, Lock, Trash2 } from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getToken } from '../utils/auth';
import { deriveSharedKey, encryptMessage, decryptMessage } from '../utils/cryptoUtils';
import { getOrCreateKeyPair } from '../utils/keyStorage';
import { fetchPublicKey } from '../services/chatKeys';
import { getPending, enqueuePending, removePending } from '../utils/pendingMessageQueue';
import { fadeInUp, staggerIn, pulse } from '../utils/motion';

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
  // Which chatId `cryptoKey`/`messages`/`keyBanner` were actually derived for.
  // Read everywhere alongside the raw state below (see effectiveCryptoKey
  // etc.) so a still-resolving channel switch can never display, encrypt
  // under, or send with another channel's leftover key/history.
  const [derivedForChannelId, setDerivedForChannelId] = useState(null);
  const [currentUserId] = useState(initialPayload?.userId || initialPayload?.id || null);
  const [currentUserRole] = useState((initialPayload?.role || '').toString().toLowerCase());
  const [errorMessage, setErrorMessage] = useState('');
  const [sendErrorMessage, setSendErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  // Non-blocking — shown while the counterpart hasn't completed one-time E2EE
  // key setup yet. Unlike errorMessage, this never disables the composer.
  const [keyBanner, setKeyBanner] = useState('');
  // Forces a re-render whenever the localStorage-backed pending queue changes
  // (enqueue or flush); the queue itself is the source of truth, not React
  // state, so channel switches need no separate hydration effect.
  const [, bumpPendingVersion] = useReducer((c) => c + 1, 0);
  const [isPrivacyMaskActive, setIsPrivacyMaskActive] = useState(false);
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  // showDeletedChannels renders the Trash view — only deleted channels, separate from active/archived.
  const [showDeletedChannels, setShowDeletedChannels] = useState(false);
  const [menuChannelId, setMenuChannelId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const preferredChannelRef = useRef('');
  const chatListRef = useRef(null);
  const messagesListRef = useRef(null);
  const mainPanelRef = useRef(null);
  const sendBtnRef = useRef(null);
  const prevMessageCountRef = useRef(0);
  const flushInProgressRef = useRef(false);
  // Tracks the latest activeChannelId synchronously, so an in-flight
  // establishSecureChannelRef call for a channel the user has since switched
  // away from can detect that and bail out instead of overwriting the newly
  // active channel's state with stale data.
  const activeChannelIdRef = useRef(null);

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

    const channelController = new AbortController();

    const loadChannels = async () => {
      try {
        // Survivors fetch all channel states once; archive/trash toggles are
        // client-side filters so socket lifecycle is not tied to view toggles.
        const response = await axios.get(`${API_BASE_URL}/api/chat/channels`, {
          headers: { Authorization: `Bearer ${token}` },
          params: currentUserRole === 'survivor' ? { includeArchived: true, includeDeleted: true } : undefined,
          signal: channelController.signal
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
        // Ignore cancellation — normal cleanup on unmount, not an error.
        if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') return;
        setErrorMessage(error.response?.data?.error || 'Failed to load chat channels.');
      }
    };

    loadChannels();

    return () => {
      channelController.abort();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [currentUserId, currentUserRole]);

  const activeChannel = channels.find((channel) => channel.chatId === activeChannelId) || null;
  const actionMenuChannel = channels.find((channel) => channel.chatId === menuChannelId) || null;
  const displayedChannels = useMemo(() => {
    if (currentUserRole !== 'survivor') return channels;
    if (showDeletedChannels) return channels.filter((channel) => channel.chatChannelStatus === 'deleted');
    if (showArchivedChannels) return channels.filter((channel) => channel.chatChannelStatus === 'archived');
    return channels.filter((channel) => channel.chatChannelStatus === 'active');
  }, [channels, currentUserRole, showArchivedChannels, showDeletedChannels]);

  // The pending queue's source of truth is localStorage, not React state —
  // bumpPendingVersion (on enqueue/flush) just forces this cheap re-read.
  const pendingMessages = activeChannelId ? getPending(activeChannelId) : [];

  // Gate cryptoKey/messages/keyBanner on the channel they were actually
  // derived for. Without this, a channel switch made while the previous
  // channel's key derivation or history fetch was still in flight could
  // display — or worse, encrypt and send under — another channel's stale
  // key/history for a brief window.
  const isChannelDataCurrent = derivedForChannelId === activeChannelId;
  const effectiveCryptoKey = isChannelDataCurrent ? cryptoKey : null;
  // Memoized so effects keyed on this array (scroll-to-bottom, append
  // animation) don't re-fire every render just because the `[]` fallback
  // below is a fresh literal each time isChannelDataCurrent is false.
  const effectiveMessages = useMemo(
    () => (isChannelDataCurrent ? messages : []),
    [isChannelDataCurrent, messages]
  );
  const effectiveKeyBanner = isChannelDataCurrent ? keyBanner : '';

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
        params: currentUserRole === 'survivor' ? { includeArchived: true, includeDeleted: true } : undefined
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
   * Derives (or re-derives) the E2EE key for a channel and loads/decrypts its
   * history. Held in a ref (refreshed whenever its inputs change) rather
   * than returned from useCallback, so the effects below can call the
   * latest version without taking on its identity as a dependency — it can
   * also be re-run when the counterpart's public key shows up later, either
   * pushed via the `chatKey:available` socket event or picked up by the
   * polling fallback, without the user having to switch chats to retry.
   *
   * Leaves cryptoKey null (with a non-blocking keyBanner explanation, not a
   * hard error) when the counterpart hasn't completed one-time key setup
   * yet; the composer stays usable and queues messages locally in that case.
   */
  const establishSecureChannelRef = useRef(async () => {});

  useEffect(() => {
    establishSecureChannelRef.current = async (channelId) => {
      if (!channelId || !currentUserId) return;

      // True once the user has switched to a different channel since this
      // call started — guards every state update below so a slow response
      // for a channel the user has navigated away from can never clobber
      // the channel they're now looking at (e.g. one channel's history
      // overwriting another's after a quick switch).
      const isStale = () => activeChannelIdRef.current !== channelId;

      try {
        const token = getToken();
        if (!token) {
          if (isStale()) return;
          setErrorMessage('Session expired. Please log in again.');
          return;
        }

        // Real E2EE key derivation: ECDH between this user's private key
        // (IndexedDB, never leaves the browser) and the counterpart's public
        // key (fetched from the server, which only ever brokers public keys).
        const channel = channels.find((c) => c.chatId === channelId);
        const counterpartUserId = channel?.counterpartUserId;
        if (!counterpartUserId) {
          if (isStale()) return;
          setCryptoKey(null);
          setMessages([]);
          setDerivedForChannelId(channelId);
          setErrorMessage('Unable to resolve the other participant for this chat.');
          return;
        }

        const peerPublicKeyJwk = await fetchPublicKey(counterpartUserId);
        if (isStale()) return;
        if (!peerPublicKeyJwk) {
          setCryptoKey(null);
          setMessages([]);
          setDerivedForChannelId(channelId);
          setKeyBanner('Secure messaging setup is still pending on the other side — you can keep typing. Your messages will be sent automatically as soon as they log in for the first time.');
          return;
        }

        const { privateKey } = await getOrCreateKeyPair(currentUserId);
        const key = await deriveSharedKey(privateKey, peerPublicKeyJwk);
        if (isStale()) return;
        // Not paired with setDerivedForChannelId yet — history is still
        // loading, so effectiveCryptoKey (gated on derivedForChannelId)
        // stays null until the final setMessages below lands alongside it.
        setCryptoKey(key);
        setKeyBanner('');

        // History endpoint returns ciphertext; decrypt client-side only.
        const response = await axios.get(`${API_BASE_URL}/api/chat/${channelId}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (isStale()) return;

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
            seenAt: dbMessage.seenAt || null,
            sentAt: dbMessage.messageDispatchTimestamp || null
          }))
        );
        if (isStale()) return;

        const demoTranscriptEnabled = String(import.meta.env.VITE_ENABLE_CHAT_DEMO_TRANSCRIPT || '').toLowerCase() === 'true';
        const shouldAddDemoTranscript = import.meta.env.DEV && demoTranscriptEnabled && decryptedHistory.length < 8;
        // Demo transcript is now explicit opt-in to avoid confusing real user timelines.
        setMessages(
          shouldAddDemoTranscript
            ? [...decryptedHistory, ...buildDemoTranscript(currentUserRole)]
            : decryptedHistory
        );
        setDerivedForChannelId(channelId);
      } catch (error) {
        if (isStale()) return;
        setCryptoKey(null);
        setMessages([]);
        setDerivedForChannelId(channelId);
        setErrorMessage(error.response?.data?.error || 'Failed to establish secure chat session.');
      }
    };
  }, [channels, currentUserId, currentUserRole]);

  /**
   * 2. Handle Active Channel Change (Join Room, Derive Key)
   *
   * Pending messages queued for this channel aren't hydrated into state here —
   * they're read directly from localStorage during render (see pendingMessages
   * below) and bumped via pendingVersion, so no setState happens synchronously
   * inside this effect.
   */
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    if (!activeChannelId || !currentUserId) return;

    // Persisting here ensures both manual chat clicks and automatic opens are remembered.
    persistPreferredChannel(activeChannelId);

    // Join the Socket room
    socketRef.current?.emit('joinChannel', activeChannelId);

    establishSecureChannelRef.current(activeChannelId);
  }, [activeChannelId, currentUserId]);

  /**
   * 2b. Listen for the counterpart completing key setup (pushed by the
   * backend when they register their public key) so this tab can retry
   * derivation immediately instead of waiting on the polling fallback.
   * Registered independently of cryptoKey so it still fires while we're
   * waiting for a key to show up.
   */
  useEffect(() => {
    if (!currentUserId) return;

    const handleKeyAvailable = ({ chatId }) => {
      if (chatId === activeChannelId) {
        establishSecureChannelRef.current(activeChannelId);
      }
    };

    socketRef.current?.on('chatKey:available', handleKeyAvailable);
    return () => socketRef.current?.off('chatKey:available', handleKeyAvailable);
  }, [activeChannelId, currentUserId]);

  /**
   * 2c. Polling fallback — in case the socket push above is missed (e.g. a
   * brief disconnect), retry key derivation every 30s while still waiting.
   * Mirrors the poll-plus-socket-push pattern already used by NotificationBell.
   */
  useEffect(() => {
    if (!activeChannelId || effectiveCryptoKey) return;

    const intervalId = window.setInterval(() => {
      establishSecureChannelRef.current(activeChannelId);
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [activeChannelId, effectiveCryptoKey]);

  /**
   * 2d. Flush the pending queue once a key becomes derivable — encrypts and
   * sends queued plaintext in order, exactly as a normal send would.
   */
  useEffect(() => {
    if (!effectiveCryptoKey || !activeChannelId || flushInProgressRef.current) return;

    const pending = getPending(activeChannelId);
    if (pending.length === 0) return;

    flushInProgressRef.current = true;

    (async () => {
      for (const entry of pending) {
        try {
          const encryptedPayload = await encryptMessage(entry.plaintext, effectiveCryptoKey);
          socketRef.current?.emit('sendEncryptedMessage', {
            chatId: activeChannelId,
            encryptedPayload
          });
          removePending(activeChannelId, entry.localId);
          bumpPendingVersion();
        } catch (err) {
          console.error('Failed to flush a queued message:', err);
          break; // Leave the rest queued — will retry next time this effect runs.
        }
      }
      flushInProgressRef.current = false;
    })();
  }, [effectiveCryptoKey, activeChannelId]);

  /**
   * 3. Listen for Incoming Live Messages
   */
  useEffect(() => {
    if (!effectiveCryptoKey || !currentUserId || !activeChannelId) return;

    // ── receiveMessage — new incoming or echoed outgoing message ──────────────
    const handleNewMessage = async (dbMessage) => {
      // Ignore events for other channels when user switches rapidly.
      if (dbMessage.chatId !== activeChannelId) return;

      // Decrypt the incoming ciphertext payload
      const plaintext = await decryptMessage(dbMessage.encryptedMessageContent, effectiveCryptoKey);

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
        seenAt: dbMessage.seenAt || null,
        sentAt: dbMessage.messageDispatchTimestamp || null
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
  }, [activeChannelId, effectiveCryptoKey, currentUserId, currentUserRole]);

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
  }, [activeChannelId, effectiveMessages.length]);

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
  }, [effectiveMessages]);

  // Stagger the sidebar chat list in whenever its contents change (initial
  // load, or toggling Archive/Trash view) — not on every render, since
  // re-running this on unrelated state changes would replay it needlessly.
  useEffect(() => {
    if (!chatListRef.current) return;
    const items = chatListRef.current.querySelectorAll('.wa-chat-item');
    if (!items.length) return;
    const mm = staggerIn(items, { y: 8, stagger: 0.04 });
    return () => mm.revert();
  }, [displayedChannels]);

  // Cross-fade the message panel when the active channel changes, so
  // switching chats reads as a deliberate transition rather than a flicker.
  useEffect(() => {
    if (!mainPanelRef.current) return;
    const mm = fadeInUp(mainPanelRef.current, { y: 6, duration: 0.28 });
    return () => mm.revert();
  }, [activeChannelId]);

  // Animate only the newest message bubble in on append — replaying the
  // whole history on every render would be both wasteful and distracting.
  useEffect(() => {
    if (!messagesListRef.current) {
      prevMessageCountRef.current = effectiveMessages.length;
      return;
    }
    const rows = messagesListRef.current.querySelectorAll('.wa-row');
    const isAppend = effectiveMessages.length > prevMessageCountRef.current && rows.length > 0;
    prevMessageCountRef.current = effectiveMessages.length;
    if (!isAppend) return;
    const mm = fadeInUp(rows[rows.length - 1], { y: 10, duration: 0.26 });
    return () => mm.revert();
  }, [effectiveMessages]);

  /**
   * 4. Encrypt and Dispatch Message
   */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUserId || !activeChannelId) return;

    // Optimistic clear keeps composer responsive while encryption/socket emits.
    const plaintext = newMessage;
    setSendErrorMessage('');
    setNewMessage(''); // Clear input

    if (!effectiveCryptoKey) {
      // Counterpart hasn't completed one-time key setup yet (or this
      // channel's key is still being derived after a switch) — hold the
      // message locally instead of sending under a stale/wrong key. It
      // auto-sends once a key becomes derivable (see the flush effect above).
      enqueuePending(activeChannelId, plaintext);
      bumpPendingVersion();
      if (sendBtnRef.current) pulse(sendBtnRef.current);
      return;
    }

    try {
      // Encrypt the message before it ever touches the network
      const encryptedPayload = await encryptMessage(plaintext, effectiveCryptoKey);

      // Emit the ciphertext payload over WebSockets
      socketRef.current?.emit('sendEncryptedMessage', {
        chatId: activeChannelId,
        encryptedPayload: encryptedPayload
      });

      if (sendBtnRef.current) pulse(sendBtnRef.current);
    } catch (err) {
      console.error('Failed to encrypt and send message:', err);
      setSendErrorMessage('Message failed to send. Please retry.');
      setNewMessage((prev) => (prev ? prev : plaintext));
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

      {/* `wa-shell--conversation-open` drives the single-pane mobile layout
          (App.css ≤960px): shows the active conversation instead of the
          channel list. Inert on wider screens, where both panes are visible. */}
      <section className={`wa-shell${activeChannelId ? ' wa-shell--conversation-open' : ''}`} aria-label="Direct chat">
        <aside className="wa-sidebar">
          <header className="wa-sidebar-header">
            <h2>Chats</h2>
            <span>{displayedChannels.length}</span>
            {currentUserRole === 'survivor' && (
              <>
                {/* Archive toggle — mutually exclusive with Trash view. Icon-only, label moved to title/aria-label. */}
                <button
                  type="button"
                  className={`link-btn icon-btn${showArchivedChannels ? ' active' : ''}`}
                  onClick={() => {
                    setShowDeletedChannels(false);
                    setShowArchivedChannels((v) => !v);
                  }}
                  title={showArchivedChannels ? 'Hide archived chats' : 'Show archived chats'}
                  aria-label={showArchivedChannels ? 'Hide archived chats' : 'Show archived chats'}
                  aria-pressed={showArchivedChannels}
                  data-testid="chat-archive-toggle"
                >
                  <Archive size={16} aria-hidden="true" />
                </button>
                {/* Trash toggle — shows only deleted channels so survivors can restore. Icon-only. */}
                <button
                  type="button"
                  className={`link-btn icon-btn${showDeletedChannels ? ' active' : ''}`}
                  onClick={() => {
                    setShowArchivedChannels(false);
                    setShowDeletedChannels((v) => !v);
                  }}
                  title={showDeletedChannels ? 'Hide Trash' : 'Show Trash'}
                  aria-label={showDeletedChannels ? 'Hide Trash' : 'Show Trash'}
                  aria-pressed={showDeletedChannels}
                  data-testid="chat-trash-toggle"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </>
            )}
          </header>

          <div className="wa-chat-list" ref={chatListRef}>
            {errorMessage && <p className="wa-error">{errorMessage}</p>}

            {displayedChannels.map((channel) => (
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
                    {currentUserRole === 'survivor' && (
                      <small className="wa-presence-row">
                        {channel.counterpartAvailability && (
                          <>
                            <span className={presenceDotClass(channel.counterpartAvailability)} aria-hidden="true" />
                            {presenceLabel(channel.counterpartAvailability)}
                          </>
                        )}
                        {channel.chatChannelStatus === 'archived' ? ' · Archived' : ''}
                        {channel.chatChannelStatus === 'deleted'  ? ' · Deleted'  : ''}
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

            {displayedChannels.length === 0 && !errorMessage && (
              <p className="wa-empty-list">
                {showDeletedChannels
                  ? 'No deleted chats in Trash.'
                  : showArchivedChannels
                    ? 'No archived chats.'
                    : 'No active direct chat channels.'}
              </p>
            )}
          </div>
        </aside>

        <div className="wa-main" ref={mainPanelRef}>
          {activeChannelId ? (
            <>
              <header className="wa-main-header">
                {/* Mobile-only: returns to the channel list (hidden ≥960px via App.css). */}
                <button
                  type="button"
                  className="wa-back-btn"
                  aria-label="Back to chat list"
                  onClick={() => setActiveChannelId(null)}
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <div className="wa-header-title">
                  <span className="wa-avatar muted">{currentUserRole === 'survivor' ? 'S' : 'U'}</span>
                  <div>
                    <strong>{currentUserRole === 'survivor' ? 'Secure Staff Channel' : 'Secure Survivor Channel'}</strong>
                    <small className="wa-e2ee-label"><Lock size={10} aria-hidden="true" /> End-to-end encrypted</small>
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
              {effectiveKeyBanner && <p role="status" className="status-message warning">{effectiveKeyBanner}</p>}
              {sendErrorMessage && <p role="alert" className="status-message warning">{sendErrorMessage}</p>}

              <div className="wa-messages" ref={messagesListRef} aria-live="polite" aria-label="Chat message timeline">
                {effectiveMessages.length === 0 && pendingMessages.length === 0 ? (
                  <p className="wa-empty-state">Messages in this channel are encrypted end-to-end.</p>
                ) : (
                  <>
                    {/* Render deterministic order from API + realtime appends. */}
                    {effectiveMessages.map((msg) => (
                      <div key={msg.messageId} className={`wa-row ${msg.isMine ? 'mine' : 'theirs'}`}>
                        <div className={`wa-bubble ${msg.isMine ? 'mine' : 'theirs'}`}>
                          <small className="wa-msg-role">{msg.senderLabel || (msg.isMine ? 'You' : 'Peer')}</small>
                          <p>{msg.plaintext}</p>
                          {msg.sentAt && (
                            <time className="wa-msg-time" dateTime={msg.sentAt}>
                              {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </time>
                          )}
                          {/* Delivery/seen ticks — only rendered on sender's own bubbles */}
                          <MessageTicks msg={msg} />
                        </div>
                      </div>
                    ))}
                    {/* Queued locally — not yet encrypted/sent, awaiting the counterpart's key setup. */}
                    {pendingMessages.map((entry) => (
                      <div key={entry.localId} className="wa-row mine">
                        <div className="wa-bubble mine">
                          <small className="wa-msg-role">You</small>
                          <p>{entry.plaintext}</p>
                          <span className="msg-ticks msg-ticks--sent" title="Will send once secure setup completes">Pending</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="wa-composer">
                <input
                  type="text"
                  placeholder="Type a message"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button ref={sendBtnRef} type="submit" className="wa-send-btn" aria-label="Send message" disabled={!newMessage.trim()}>
                  <Send size={14} aria-hidden="true" />
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
          {actionMenuChannel.chatChannelStatus === 'deleted' ? (
            /* Trash view: only Restore is available. Delete/Archive are blocked for deleted channels. */
            <button type="button" data-testid="chat-restore" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'active')}>
              <ArchiveRestore size={14} aria-hidden="true" /> Restore Chat
            </button>
          ) : actionMenuChannel.chatChannelStatus === 'archived' ? (
            /* Archived view: Restore or Delete. */
            <>
              <button type="button" data-testid="chat-restore" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'active')}>
                <ArchiveRestore size={14} aria-hidden="true" /> Restore Chat
              </button>
              <button type="button" className="danger" data-testid="chat-move-to-trash" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'deleted')}>
                <Trash2 size={14} aria-hidden="true" /> Move to Trash
              </button>
            </>
          ) : (
            /* Active view: Archive or Delete. */
            <>
              <button type="button" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'archived')}>
                <Archive size={14} aria-hidden="true" /> Archive Chat
              </button>
              <button type="button" className="danger" data-testid="chat-move-to-trash" onClick={() => updateChannelStatus(actionMenuChannel.chatId, 'deleted')}>
                <Trash2 size={14} aria-hidden="true" /> Move to Trash
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default DirectChatPage;