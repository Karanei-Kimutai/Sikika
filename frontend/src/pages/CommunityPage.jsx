import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const QUICK_EXIT_URL = "https://www.google.com";

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
  const [reportReasonByMessage, setReportReasonByMessage] = useState({});
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const activeRoomIdRef = useRef("");

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

    socket.on("community:new-message", handleIncomingMessage);
    socket.on("community:message-updated", handleMessageUpdated);

    return () => {
      socket.off("community:new-message", handleIncomingMessage);
      socket.off("community:message-updated", handleMessageUpdated);
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
    const reason = String(reportReasonByMessage[messageId] || "").trim();
    if (!reason) {
      setErrorMessage("Please provide a reason before reporting content.");
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

      setReportReasonByMessage((current) => ({
        ...current,
        [messageId]: ""
      }));
      setSuccessMessage("Content reported successfully.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not report content.");
    }
  }

  return (
    <main className="community-page">
      <button type="button" className="quick-exit" onClick={() => window.location.replace(QUICK_EXIT_URL)}>
        Quick Exit
      </button>

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
            <p>Survivors appear by nickname only. Staff posts are verified badges.</p>
          </header>

          {errorMessage && <p className="status-message warning">{errorMessage}</p>}
          {successMessage && <p className="status-message">{successMessage}</p>}

          <div className="community-feed">
            {messages.map((message) => (
              <article key={message.communityMessageId} className="community-message-card">
                <div className="community-message-meta">
                  <strong>{message.author?.displayName || "Community Member"}</strong>
                  {message.author?.badge && <span className="verified-badge">{message.author.badge}</span>}
                </div>
                <p>{message.publicMessageContent}</p>

                <div className="community-report-row">
                  <input
                    type="text"
                    placeholder="Reason for report"
                    value={reportReasonByMessage[message.communityMessageId] || ""}
                    onChange={(event) =>
                      setReportReasonByMessage((current) => ({
                        ...current,
                        [message.communityMessageId]: event.target.value
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleReportMessage(message.communityMessageId)}
                  >
                    Report Post
                  </button>
                </div>
              </article>
            ))}

            {messages.length === 0 && <p className="wa-empty-state">No posts yet for this room.</p>}
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
