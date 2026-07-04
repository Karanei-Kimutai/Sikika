import { useEffect, useRef } from "react";

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
 * Focus management: focuses the reason textarea on open, traps Tab inside
 * the modal, and restores focus to the trigger element on close.
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
  const articleRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!banModal) return;

    // Save the element that had focus before the modal opened so we can
    // return focus to it when the modal closes.
    previousFocusRef.current = document.activeElement;

    // Move focus into the modal on the next tick (after the element mounts).
    const timerId = window.setTimeout(() => {
      const firstFocusable = articleRef.current?.querySelector(
        'textarea, input, button:not([disabled])'
      );
      firstFocusable?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
      // Restore focus to the trigger element when the modal closes.
      previousFocusRef.current?.focus();
    };
  }, [banModal]);

  if (!banModal) return null;

  /**
   * Focus trap: keep Tab and Shift+Tab cycling inside the modal so keyboard
   * users can't escape into background content.
   */
  function handleArticleKeyDown(e) {
    if (e.key === "Escape") {
      setBanModal(null);
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = Array.from(
      articleRef.current?.querySelectorAll(
        'textarea, input, button:not([disabled])'
      ) || []
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      className="admin-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ban-modal-title"
      onClick={() => setBanModal(null)}
    >
      <article
        ref={articleRef}
        className="admin-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleArticleKeyDown}
      >
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
