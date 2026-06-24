import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { getMyCallbackRequests, updateUssdCallbackRequest } from "../services/admin";
import { formatDate, prettifyLabel } from "./ngo-admin/helpers";
import { staggerIn } from "../utils/motion";

/**
 * MyCallbacksPage
 * ---------------
 * Counsellor-facing view of USSD callback requests auto-assigned to them.
 * USSD callback auto-routing (ussdController.js) picks the least-loaded
 * counsellor at creation time, but until this page existed only the NGO
 * Admin's queue showed who a request landed on — the assigned counsellor
 * had no visibility into their own callbacks beyond a notification.
 */
export default function MyCallbacksPage() {
  const [callbacks, setCallbacks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const tableRef = useRef(null);

  // Stagger the callback rows in once the list loads.
  useEffect(() => {
    if (!tableRef.current) return;
    const rows = tableRef.current.querySelectorAll('tbody tr');
    if (!rows.length) return;
    const mm = staggerIn(rows, { y: 8, stagger: 0.04 });
    return () => mm.revert();
  }, [callbacks]);

  async function loadCallbacks() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const data = await getMyCallbackRequests();
      setCallbacks(data.requests || []);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not load your callback requests.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadCallbacks();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, []);

  async function handleUpdate(requestId, status) {
    setUpdatingId(requestId);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await updateUssdCallbackRequest(requestId, status);
      setSuccessMessage(`Callback request marked as ${status.toLowerCase()}.`);
      await loadCallbacks();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update callback request.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <main className="library-page">
      {errorMessage && <p className="status-message warning" role="alert">{errorMessage}</p>}
      {successMessage && <p className="status-message" role="status">{successMessage}</p>}

      {/* Header chrome (h2 + admin-note inside the panel) intentionally mirrors
          the NGO Admin's UssdCallbacksSection.jsx so the two queues look like
          the same feature, just scoped to "my" requests vs. all requests. */}
      <section className="admin-module-grid" aria-label="My callback requests">
        <article className="admin-panel full-span">
          <h2>My Callback Requests</h2>
          <p className="admin-note">
            Callback requests submitted via the USSD interface (*384#) that have been
            auto-assigned to you. Mark a request completed once you've followed up, or
            cancelled if the number is unreachable.
          </p>
          <div className="admin-table-wrap" ref={tableRef}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Phone number</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {callbacks.map((cb) => (
                  <tr key={cb.callbackRequestId}>
                    <td>{formatDate(cb.callbackRequestTimestamp)}</td>
                    <td>
                      <a href={`tel:${cb.requesterPhoneNumber}`} className="phone-link">
                        {cb.requesterPhoneNumber}
                      </a>
                    </td>
                    <td>
                      <span className={
                        cb.callbackFulfillmentStatus === "COMPLETED"
                          ? "pill priority-low"
                          : cb.callbackFulfillmentStatus === "CANCELLED"
                            ? "pill priority-medium"
                            : "pill priority-high"
                      }>
                        {prettifyLabel(cb.callbackFulfillmentStatus)}
                      </span>
                    </td>
                    <td>
                      {cb.callbackFulfillmentStatus === "PENDING" ? (
                        <div className="inline-action-row">
                          <button
                            type="button"
                            className="admin-action-btn"
                            onClick={() => handleUpdate(cb.callbackRequestId, "COMPLETED")}
                            disabled={updatingId === cb.callbackRequestId}
                          >
                            {updatingId === cb.callbackRequestId ? "Saving..." : "Mark Completed"}
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn secondary"
                            onClick={() => handleUpdate(cb.callbackRequestId, "CANCELLED")}
                            disabled={updatingId === cb.callbackRequestId}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isLoading && callbacks.length === 0 && (
            <p className="admin-empty" style={{ marginTop: "0.8rem" }}>
              <Inbox size={18} aria-hidden="true" />
              No callback requests assigned to you yet.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
