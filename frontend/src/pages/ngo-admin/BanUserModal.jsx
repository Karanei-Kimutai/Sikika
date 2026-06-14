/**
 * BanUserModal
 * ------------
 * Shared dialog for banning a user account.  Rendered once at the
 * NgoAdminDashboardPage root so it sits above all section components.
 *
 * Two code paths exist depending on how the modal was opened:
 * - With a reportId (from Moderation Desk): the ban is submitted via
 *   reviewModerationReport so the report is resolved atomically.
 * - Without a reportId (from Staff Directory or Banned Users registry):
 *   the ban is submitted directly via banUser.
 *
 * State for banModal / banForm / banLoading lives in the parent; this
 * component is purely presentational.
 *
 * @param {object}   props
 * @param {object|null} props.banModal    - null when closed; { userId, label, reportId? } when open.
 * @param {Function} props.setBanModal    - Setter to close (pass null) the modal.
 * @param {{ reason: string, expiresAt: string }} props.banForm - Controlled form state.
 * @param {Function} props.setBanForm     - Setter for banForm.
 * @param {boolean}  props.banLoading     - True while the ban request is in-flight.
 * @param {Function} props.onSubmit       - Form submit handler (event) → void.
 */
export default function BanUserModal({
  banModal,
  setBanModal,
  banForm,
  setBanForm,
  banLoading,
  onSubmit
}) {
  if (!banModal) return null;

  return (
    <div
      className="admin-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ban-modal-title"
      onClick={() => setBanModal(null)}
      onKeyDown={(e) => e.key === "Escape" && setBanModal(null)}
    >
      <article className="admin-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="ban-modal-title">Ban Account</h3>
        <p className="admin-empty" style={{ marginBottom: "1rem" }}>
          Banning <strong>{banModal.label}</strong> will immediately block all platform access,
          including active sessions. The account can be unbanned at any time from the Staff Directory.
        </p>

        <form onSubmit={onSubmit}>
          <div className="ban-modal-field">
            <label>
              Ban reason <span>*</span>
              <textarea
                value={banForm.reason}
                onChange={(e) => setBanForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Describe the policy violation or reason for the ban…"
                rows={3}
                required
              />
            </label>
          </div>

          <div className="ban-modal-field">
            <label>
              Ban expires (optional — leave blank for permanent)
              <input
                type="date"
                value={banForm.expiresAt}
                onChange={(e) => setBanForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
              />
            </label>
          </div>

          <div className="admin-confirm-actions">
            <button
              type="submit"
              className="admin-action-btn danger"
              disabled={banLoading || !banForm.reason.trim()}
            >
              {banLoading ? "Applying ban…" : "Confirm Ban"}
            </button>
            <button type="button" className="secondary-btn" onClick={() => setBanModal(null)}>
              Cancel
            </button>
          </div>
        </form>
      </article>
    </div>
  );
}
