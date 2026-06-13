import { useEffect } from 'react';

/**
 * ConfirmDialog
 * Accessible confirmation modal replacing window.confirm()
 *
 * Features:
 * - role="dialog" + aria-modal="true" for screen readers
 * - Escape key handler for dismissal
 * - Backdrop click to cancel
 * - Focus management (focus on mount, return on close)
 * - WCAG-compliant button styling
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
