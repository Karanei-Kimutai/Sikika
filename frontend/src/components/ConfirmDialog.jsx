import { useEffect, useRef } from 'react';

/**
 * ConfirmDialog
 * -------------
 * Accessible confirmation modal replacing `window.confirm()`.
 *
 * Features:
 * - `role="dialog"` + `aria-modal="true"` for screen readers
 * - Escape key handler for dismissal
 * - Backdrop click to cancel
 * - Focus management: initial focus, focus trap, focus restore on close
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
  const overlayRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement;
    window.setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 0);

    return () => {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e) {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      // Focus trap: keep Tab/Shift+Tab cycling inside the modal so keyboard
      // users can't tab into background content while it's open.
      if (e.key === 'Tab' && overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
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
            ref={confirmButtonRef}
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
