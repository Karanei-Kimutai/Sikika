import { formatDate, prettifyLabel } from "./helpers";

/**
 * UssdCallbacksSection
 * --------------------
 * Displays USSD callback requests received via the *384# interface and lets
 * NGO admins mark them COMPLETED or CANCELLED.
 *
 * @param {object}   props
 * @param {Array}    props.ussdCallbacks       - List of callback request objects.
 * @param {string}   props.updatingCallbackId  - callbackRequestId of the in-flight update.
 * @param {Function} props.onUpdateCallback    - (requestId, status) → void.
 */
export default function UssdCallbacksSection({ ussdCallbacks, updatingCallbackId, onUpdateCallback }) {
  return (
    <section className="admin-module-grid" aria-label="USSD callback requests">
      <article className="admin-panel full-span">
        <h2>USSD Callback Requests</h2>
        <p className="admin-note">
          These are callback requests submitted by callers via the USSD interface (*384#).
          Mark each request completed once your team has followed up, or cancelled if the
          number is unreachable.
        </p>
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
              {ussdCallbacks.map((cb) => (
                <tr key={cb.callbackRequestId}>
                  <td>{formatDate(cb.callbackRequestTimestamp)}</td>
                  <td>{cb.requesterPhoneNumber}</td>
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
                          onClick={() => onUpdateCallback(cb.callbackRequestId, "COMPLETED")}
                          disabled={updatingCallbackId === cb.callbackRequestId}
                        >
                          {updatingCallbackId === cb.callbackRequestId ? "Saving..." : "Mark Completed"}
                        </button>
                        <button
                          type="button"
                          className="admin-action-btn secondary"
                          onClick={() => onUpdateCallback(cb.callbackRequestId, "CANCELLED")}
                          disabled={updatingCallbackId === cb.callbackRequestId}
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
        {ussdCallbacks.length === 0 && (
          <p className="admin-empty" style={{ marginTop: "0.8rem" }}>
            No USSD callback requests yet.
          </p>
        )}
      </article>
    </section>
  );
}
