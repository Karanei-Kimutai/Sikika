import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { getToken, getUserId } from "../utils/auth";
import ConfirmDialog from "../components/ConfirmDialog";

/**
 * CommunityPage
 * -------------
 * Membership-gated community forum UI.
 *
 * UX rules implemented here:
 * - only joined rooms can display/post messages
 * - NGO admins can create rooms via modal flow
 * - room list prioritizes latest activity
 * - chat viewport anchors to most recent messages
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const socket = io(API_BASE_URL, { autoConnect: false });

function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Role claim is read client-side only for UI toggles (e.g., create-room button).
// Actual authorization remains enforced by backend endpoints.
function readRoleFromToken() {
  try {
    const token = getToken() || "";
    const [, payload] = token.split(".");
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const json = JSON.parse(atob(padded));
    return String(json?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

// Converts potentially invalid timestamps into sortable epoch values.
function toEpoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Keeps most recently active rooms at the top of the room list.
function sortRoomsByActivity(roomList) {
  return [...roomList].sort((a, b) => {
    const aTime = toEpoch(a.latestMessageDispatchTimestamp) || toEpoch(a.roomCreationTimestamp);
    const bTime = toEpoch(b.latestMessageDispatchTimestamp) || toEpoch(b.roomCreationTimestamp);
    return bTime - aTime;
  });
}

function formatRoomTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CommunityPage() {
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [activeMessageMenuId, setActiveMessageMenuId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [currentUserRole] = useState(() => readRoleFromToken());
  const [roomName, setRoomName] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetMessageId, setReportTargetMessageId] = useState("");
  const [reportReasonText, setReportReasonText] = useState("");
  const [deleteMessageConfirmId, setDeleteMessageConfirmId] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [submittingRoom, setSubmittingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [roomQuery, setRoomQuery] = useState("");
  const activeRoomIdRef = useRef("");
  const messagesViewportRef = useRef(null);

  const currentUserId = localStorage.getItem("userId");
  const isNgoAdmin = currentUserRole === "NGO_ADMIN";
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId) || null;
  // Membership gate: only joined rooms can load/render message history.
  const canAccessActiveRoom = Boolean(activeRoom?.joined);
  const filteredRooms = rooms.filter((room) => {
    const query = roomQuery.trim().toLowerCase();
    if (!query) return true;
    const name = String(room.roomName || "").toLowerCase();
    return name.includes(query);
  });

  // Pulls rooms and preserves selection when possible.
  async function loadRooms({ silent = false } = {}) {
    if (!silent) setErrorMessage("");
    try {
      const response = await axios.get(`${API_BASE_URL}/api/community/rooms`, {
        headers: getAuthHeaders()
      });
      const nextRooms = sortRoomsByActivity(response.data.rooms || []);
      setRooms(nextRooms);
      setActiveRoomId((current) => {
        if (nextRooms.some((room) => room.roomId === current)) return current;
        return nextRooms[0]?.roomId || "";
      });
    } catch (error) {
      if (!silent) {
        setErrorMessage(error.response?.data?.error || "Failed to load community rooms.");
      }
    }
  }

  async function loadMessages(roomId) {
    if (!roomId) return;

    setErrorMessage("");
    try {
      const response = await axios.get(`${API_BASE_URL}/api/community/rooms/${roomId}/messages`, {
        headers: getAuthHeaders()
      });
      const nextMessages = response.data.messages || [];
      setMessages(nextMessages);

      // Sync local room ordering even when messages were loaded via REST.
      const lastMessage = nextMessages[nextMessages.length - 1] || null;
      if (lastMessage?.messageDispatchTimestamp) {
        setRooms((current) => sortRoomsByActivity(
          current.map((room) => (
            room.roomId === roomId
              ? { ...room, latestMessageDispatchTimestamp: lastMessage.messageDispatchTimestamp }
              : room
          ))
        ));
      }
    } catch (error) {
      setMessages([]);
      setErrorMessage(error.response?.data?.error || "Failed to load room messages.");
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadRooms();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  // Light polling keeps room ordering fresh if other users are active.
  useEffect(() => {
    const timerId = setInterval(() => {
      loadRooms({ silent: true });
    }, 15000);

    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    socket.auth = { token };
    socket.connect();

    const handleIncomingMessage = ({ roomId, message }) => {
      // Any incoming message bumps the corresponding room to the top.
      setRooms((current) => sortRoomsByActivity(
        current.map((room) => (
          room.roomId === roomId
            ? {
              ...room,
              latestMessageDispatchTimestamp: message?.messageDispatchTimestamp || new Date().toISOString()
            }
            : room
        ))
      ));

      if (roomId !== activeRoomIdRef.current) return;

      setMessages((current) => {
        if (current.some((entry) => entry.communityMessageId === message.communityMessageId)) {
          return current;
        }
        return [...current, message];
      });
    };

    const handleMessageUpdated = ({ roomId, messageId, publicMessageContent }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setMessages((current) =>
        current.map((entry) =>
          entry.communityMessageId === messageId
            ? { ...entry, publicMessageContent }
            : entry
        )
      );
    };

    const handleMessageDeleted = ({ roomId, messageId }) => {
      if (roomId !== activeRoomIdRef.current) return;
      setMessages((current) => current.filter((entry) => entry.communityMessageId !== messageId));
    };

    socket.on("community:new-message", handleIncomingMessage);
    socket.on("community:message-updated", handleMessageUpdated);
    socket.on("community:message-deleted", handleMessageDeleted);

    return () => {
      socket.off("community:new-message", handleIncomingMessage);
      socket.off("community:message-updated", handleMessageUpdated);
      socket.off("community:message-deleted", handleMessageDeleted);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeRoomId && canAccessActiveRoom) {
      const timerId = window.setTimeout(() => {
        void loadMessages(activeRoomId);
      }, 0);
      socket.emit("joinCommunityRoom", activeRoomId);
      return () => window.clearTimeout(timerId);
    }

    const timerId = window.setTimeout(() => {
      setMessages([]);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [activeRoomId, canAccessActiveRoom]);

  useEffect(() => {
    if (!showCreateRoomModal) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowCreateRoomModal(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreateRoomModal]);

  useEffect(() => {
    if (!canAccessActiveRoom) return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    // Entering a room or receiving messages always anchors to the latest message.
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, activeRoomId, canAccessActiveRoom]);

  async function handleCreateRoom(event) {
    event.preventDefault();
    const trimmedName = roomName.trim();
    const trimmedDescription = roomDescription.trim();
    if (!trimmedName) {
      setErrorMessage("Room name is required.");
      return;
    }

    setSubmittingRoom(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/community/rooms`,
        {
          roomName: trimmedName,
          roomDescriptionText: trimmedDescription || undefined
        },
        { headers: getAuthHeaders() }
      );
      setRoomName("");
      setRoomDescription("");
      await loadRooms({ silent: true });
      if (response.data?.room?.roomId) {
        setActiveRoomId(response.data.room.roomId);
      }
      setShowCreateRoomModal(false);
      setSuccessMessage("Room created.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to create room.");
    } finally {
      setSubmittingRoom(false);
    }
  }

  async function handleJoinActiveRoom() {
    if (!activeRoomId) return;

    setJoiningRoom(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await axios.post(
        `${API_BASE_URL}/api/community/rooms/${activeRoomId}/join`,
        {},
        { headers: getAuthHeaders() }
      );

      setRooms((current) => sortRoomsByActivity(
        current.map((room) =>
          room.roomId === activeRoomId
            ? {
              ...room,
              joined: true,
              membersCount: room.joined
                ? Number(room.membersCount || 0)
                : Number(room.membersCount || 0) + 1
            }
            : room
        )
      ));

      await loadMessages(activeRoomId);
      setSuccessMessage("Joined room successfully.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to join room.");
    } finally {
      setJoiningRoom(false);
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault();
    if (!activeRoomId || !newMessage.trim()) return;

    setErrorMessage("");
    setSuccessMessage("");

    try {
      await axios.post(
        `${API_BASE_URL}/api/community/rooms/${activeRoomId}/messages`,
        { content: newMessage.trim() },
        { headers: getAuthHeaders() }
      );
      setNewMessage("");
      await loadMessages(activeRoomId);
      setSuccessMessage("Message posted.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to post message.");
    }
  }

  function openReportModal(messageId) {
    setReportTargetMessageId(messageId);
    setReportReasonText("");
    setShowReportModal(true);
    setActiveMessageMenuId("");
    setErrorMessage("");
  }

  function closeReportModal() {
    setShowReportModal(false);
    setReportTargetMessageId("");
    setReportReasonText("");
  }

  async function handleReportMessage() {
    const reason = String(reportReasonText || "").trim();
    if (!reportTargetMessageId || !reason) {
      setErrorMessage("Add a reason to submit a report.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setSubmittingReport(true);

    try {
      await axios.post(
        `${API_BASE_URL}/api/community/messages/${reportTargetMessageId}/report`,
        { reason },
        { headers: getAuthHeaders() }
      );

      setSuccessMessage("Content reported successfully.");
      closeReportModal();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not report content.");
    } finally {
      setSubmittingReport(false);
    }
  }

  function handleDeleteMessageClick(messageId) {
    setDeleteMessageConfirmId(messageId);
  }

  async function handleDeleteMessageConfirm() {
    const messageId = deleteMessageConfirmId;
    setDeleteMessageConfirmId("");
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await axios.delete(`${API_BASE_URL}/api/community/messages/${messageId}`, {
        headers: getAuthHeaders()
      });
      setMessages((current) => current.filter((message) => message.communityMessageId !== messageId));
      setSuccessMessage("Message deleted.");
      setActiveMessageMenuId("");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not delete message.");
    }
  }

  function handleDeleteMessageCancel() {
    setDeleteMessageConfirmId("");
  }

  return (
    <main className="community-page">
      <section className="community-shell" aria-label="Community forum">
        <aside className="community-sidebar">
          <div className="community-sidebar-head">
            <h2>Community</h2>
            {isNgoAdmin && (
              <button
                type="button"
                className="community-create-room-btn"
                onClick={() => setShowCreateRoomModal(true)}
              >
                + Room
              </button>
            )}
          </div>

          <input
            type="text"
            className="community-room-search"
            placeholder="Search rooms"
            value={roomQuery}
            onChange={(event) => setRoomQuery(event.target.value)}
          />

          <div className="community-room-list" aria-label="Available rooms">
            {filteredRooms.map((room) => (
              <button
                key={room.roomId}
                type="button"
                className={`community-room-item ${activeRoomId === room.roomId ? "active" : ""}`}
                onClick={() => setActiveRoomId(room.roomId)}
              >
                <div className="community-room-title-row">
                  <strong>{room.roomName}</strong>
                  <small>{formatRoomTime(room.latestMessageDispatchTimestamp || room.roomCreationTimestamp)}</small>
                </div>
                <small>{room.joined ? `${room.membersCount} members` : "Tap to join"}</small>
              </button>
            ))}
            {filteredRooms.length === 0 && (
              <p className="community-empty-rooms">No rooms match your search.</p>
            )}
          </div>
        </aside>

        <section className="community-main">
          <header className="community-main-head">
            <h1>{activeRoom?.roomName || "Community Chat"}</h1>
            {activeRoom && (
              <div className="community-active-room-bar">
                <span>{activeRoom.joined ? `${activeRoom.membersCount} members` : "Join to start chatting"}</span>
                {!canAccessActiveRoom && (
                  <button type="button" className="primary-btn" onClick={handleJoinActiveRoom} disabled={joiningRoom}>
                    {joiningRoom ? "Joining..." : "Join Room"}
                  </button>
                )}
              </div>
            )}
          </header>

          {errorMessage && <p role="alert" className="status-message warning">{errorMessage}</p>}
          {successMessage && <p className="status-message">{successMessage}</p>}

          <div className="community-messages" ref={messagesViewportRef}>
            {canAccessActiveRoom && messages.map((message) => (
              <article
                key={message.communityMessageId}
                className={`community-row ${message.senderUserId === currentUserId ? "mine" : "theirs"}`}
              >
                <div className={`community-bubble ${message.senderUserId === currentUserId ? "mine" : "theirs"}`}>
                  <div className="community-message-meta">
                    <strong>{message.author?.displayName || "Community Member"}</strong>
                    {message.author?.badge && <span className="verified-badge">{message.author.badge}</span>}

                    <button
                      type="button"
                      className="message-menu-trigger"
                      onClick={() =>
                        setActiveMessageMenuId((current) =>
                          current === message.communityMessageId ? "" : message.communityMessageId
                        )
                      }
                    >
                      ...
                    </button>
                  </div>

                  <p>{message.publicMessageContent}</p>

                  {activeMessageMenuId === message.communityMessageId && (
                    <div className="message-actions-menu">
                      {message.senderUserId !== currentUserId && (
                        <button type="button" onClick={() => openReportModal(message.communityMessageId)}>
                          Report Message
                        </button>
                      )}

                      {message.senderUserId === currentUserId && (
                        <button type="button" onClick={() => handleDeleteMessageClick(message.communityMessageId)}>
                          Delete My Message
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {canAccessActiveRoom && messages.length === 0 && (
              <div className="community-empty-state">
                <h2>No messages yet</h2>
                <p>Start the conversation with a supportive message.</p>
              </div>
            )}

            {!canAccessActiveRoom && activeRoom && (
              <div className="community-empty-state">
                <h2>Join to view messages</h2>
                <p>This room is membership-gated. Join first, then you can read and post messages.</p>
              </div>
            )}
          </div>

          <form className="community-composer" onSubmit={handleSendMessage}>
            <input
              type="text"
              placeholder="Share support, advice, or encouragement"
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              disabled={!canAccessActiveRoom}
            />
            <button type="submit" className="primary-btn" disabled={!newMessage.trim() || !canAccessActiveRoom}>
              Post
            </button>
          </form>
        </section>
      </section>

      {showReportModal && (
        <div
          className="admin-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="community-report-title"
          onClick={closeReportModal}
        >
          <form
            className="admin-confirm-modal community-report-modal"
            onSubmit={(event) => {
              event.preventDefault();
              handleReportMessage();
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="community-report-title">Report Message</h3>
            <p>Help moderators understand what happened by adding a clear reason.</p>
            <textarea
              rows={4}
              value={reportReasonText}
              onChange={(event) => setReportReasonText(event.target.value)}
              placeholder="Describe why this message should be reviewed."
            />
            <div className="admin-confirm-actions">
              <button type="button" className="secondary-btn" onClick={closeReportModal} disabled={submittingReport}>
                Cancel
              </button>
              <button type="submit" className="admin-action-btn" disabled={submittingReport || !reportReasonText.trim()}>
                {submittingReport ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCreateRoomModal && isNgoAdmin && (
        <div
          className="admin-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-community-room-title"
          onClick={() => setShowCreateRoomModal(false)}
        >
          <form
            className="admin-confirm-modal community-create-room-form"
            onSubmit={handleCreateRoom}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="create-community-room-title">Create Community Room</h3>
            <p>Create a moderated room with a clear purpose so survivors can join safely.</p>
            <input
              type="text"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="General Support"
            />
            <textarea
              value={roomDescription}
              onChange={(event) => setRoomDescription(event.target.value)}
              placeholder="Purpose and moderation focus"
              rows={3}
            />
            <div className="admin-confirm-actions">
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setShowCreateRoomModal(false)}
                disabled={submittingRoom}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="admin-action-btn"
                disabled={submittingRoom || !roomName.trim()}
              >
                {submittingRoom ? "Creating..." : "Create Room"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteMessageConfirmId}
        title="Delete Message"
        message="This message will be permanently deleted. You cannot undo this action."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteMessageConfirm}
        onCancel={handleDeleteMessageCancel}
        variant="danger"
      />
    </main>
  );
}

export default CommunityPage;
