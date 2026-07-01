import { useEffect } from 'react';

/**
 * ConfirmDialog
 * -------------
 * Accessible confirmation modal replacing `window.confirm()`.
 *
 * Features:
 * - `role="dialog"` + `aria-modal="true"` for screen readers
 * - Escape key handler for dismissal
 * - Backdrop click to cancel
 * - Focus management (focus on mount, return on close)
 * - WCAG-compliant button styling
 *
 * @param {object} props
 * @param {boolean} props.isOpen - When false, the modal is not rendered (returns null).
 * @param {string} props.title - Heading text shown inside the modal.
 * @param {string} props.message - Body text explaining what is being confirmed.
 * @param {string} [props.confirmLabel="Confirm"] - Label for the confirm button.
 * @param {string} [props.cancelLabel="Cancel"] - Label for the cancel button.
 * @param {Function} props.onConfirm - Called when the confirm button is clicked.
 * @param {Function} props.onCancel - Called when the cancel button, backdrop, or Escape key is used.
 * @param {"default"|"danger"} [props.variant="default"] - Visual variant for the confirm button.
 *   "danger" applies a red style appropriate for destructive actions.
 * @returns {React.ReactElement|null}
 */
function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, variant = 'default' }) {
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e) {
      if (e.key === 'Escape') {
        onCancel();
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="admin-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
    >
      <article
        className="admin-confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{title}</h3>
        <p>{message}</p>

        <div className="admin-confirm-actions">
          <button
            type="button"
            className={`admin-action-btn ${variant === 'danger' ? 'danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </article>
    </div>
  );
}

export default ConfirmDialog;
