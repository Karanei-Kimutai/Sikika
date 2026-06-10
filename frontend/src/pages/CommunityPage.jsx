import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const socket = io(API_BASE_URL, { autoConnect: false });

function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function CommunityPage() {
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [activeMessageMenuId, setActiveMessageMenuId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const activeRoomIdRef = useRef("");

  const currentUserId = localStorage.getItem("userId");

  async function loadRooms() {
    setErrorMessage("");
    try {
      const response = await axios.get(`${API_BASE_URL}/api/community/rooms`, {
        headers: getAuthHeaders()
      });
      const nextRooms = response.data.rooms || [];
      setRooms(nextRooms);
      setActiveRoomId((current) => current || nextRooms[0]?.roomId || "");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to load community rooms.");
    }
  }

  async function loadMessages(roomId) {
    if (!roomId) return;

    setErrorMessage("");
    try {
      await axios.post(
        `${API_BASE_URL}/api/community/rooms/${roomId}/join`,
        {},
        { headers: getAuthHeaders() }
      );

      const response = await axios.get(`${API_BASE_URL}/api/community/rooms/${roomId}/messages`, {
        headers: getAuthHeaders()
      });
      setMessages(response.data.messages || []);
    } catch (error) {
      setMessages([]);
      setErrorMessage(error.response?.data?.error || "Failed to load room messages.");
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) return;

    socket.auth = { token };
    socket.connect();

    const handleIncomingMessage = ({ roomId, message }) => {
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
    if (activeRoomId) {
      loadMessages(activeRoomId);
      socket.emit("joinCommunityRoom", activeRoomId);
    }
  }, [activeRoomId]);

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

  async function handleReportMessage(messageId) {
    const reason = String(window.prompt("Why are you reporting this message?") || "").trim();
    if (!reason) {
      setErrorMessage("Report cancelled. Add a reason to submit a report.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    try {
      await axios.post(
        `${API_BASE_URL}/api/community/messages/${messageId}/report`,
        { reason },
        { headers: getAuthHeaders() }
      );

      setSuccessMessage("Content reported successfully.");
      setActiveMessageMenuId("");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not report content.");
    }
  }

  async function handleDeleteMessage(messageId) {
    const confirmed = window.confirm("Delete this message?");
    if (!confirmed) return;

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

  return (
    <main className="community-page">
      <section className="community-shell" aria-label="Community forum">
        <aside className="community-sidebar">
          <h2>Community Rooms</h2>
          {rooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              className={`community-room-item ${activeRoomId === room.roomId ? "active" : ""}`}
              onClick={() => setActiveRoomId(room.roomId)}
            >
              <strong>{room.roomName}</strong>
              <small>{room.membersCount} members</small>
            </button>
          ))}
        </aside>

        <section className="community-main">
          <header>
            <h1>Community Support Forum</h1>
            <p>Live room chat with nickname privacy and discreet moderation tools.</p>
          </header>

          {errorMessage && <p className="status-message warning">{errorMessage}</p>}
          {successMessage && <p className="status-message">{successMessage}</p>}

          <div className="community-messages">
            {messages.map((message) => (
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
                      <button type="button" onClick={() => handleReportMessage(message.communityMessageId)}>
                        Report Message
                      </button>

                      {message.senderUserId === currentUserId && (
                        <button type="button" onClick={() => handleDeleteMessage(message.communityMessageId)}>
                          Delete My Message
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {messages.length === 0 && (
              <div className="community-empty-state">
                <h2>No messages yet</h2>
                <p>Start the conversation with a supportive message.</p>
              </div>
            )}
          </div>

          <form className="community-composer" onSubmit={handleSendMessage}>
            <input
              type="text"
              placeholder="Share support, advice, or encouragement"
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
            />
            <button type="submit" className="primary-btn" disabled={!newMessage.trim()}>
              Post
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

export default CommunityPage;
