import { useEffect, useState } from "react";
import { getMyCallbackRequests, updateUssdCallbackRequest } from "../services/admin";

/** @param {*} value @returns {string} */
function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

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
      <section className="library-intro">
        <h1>My Callback Requests</h1>
        <p>
          Callback requests submitted via the USSD interface (*384#) that have been
          auto-assigned to you. Mark a request completed once you've followed up, or
          cancelled if the number is unreachable.
        </p>
      </section>

      {errorMessage && <p className="status-message warning" role="alert">{errorMessage}</p>}
      {successMessage && <p className="status-message" role="status">{successMessage}</p>}

      <section className="admin-module-grid" aria-label="My callback requests">
        <article className="admin-panel full-span">
          <div className="admin-table-wrap">
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
                        {cb.callbackFulfillmentStatus}
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
              No callback requests assigned to you yet.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
