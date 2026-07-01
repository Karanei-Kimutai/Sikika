import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { getToken, setToken, setUserId } from "../utils/auth";
import SignInFlow from "./auth/SignInFlow";
import SignUpFlow from "./auth/SignUpFlow";
import SikikaLogo from "../components/SikikaLogo";

/**
 * AuthPage
 * --------
 * Orchestrates the two authentication modes (Sign In / Sign Up).
 *
 * Responsibilities:
 * - Manages `authMode` and the tab-switcher UI
 * - Owns shared feedback state (loading, errorMessage, successMessage)
 * - Provides `finalizeLogin`, `clearMessages`, and `formatApiError` utilities
 *   passed down to both sub-flow components
 * - Delegates all flow-specific state and API calls to SignInFlow / SignUpFlow
 *
 * Security note: `sessionStorage` is used instead of `localStorage` so the
 * session token clears when the browser tab is closed — safer on shared/surveilled devices.
 *
 * @param {object} props
 * @param {Function} props.onNavigate - App.jsx's pushState navigator; used to redirect after login or mode switch.
 * @returns {React.ReactElement}
 */
function AuthPage({ onNavigate }) {
  const [authMode, setAuthMode] = useState("signin");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    // Keep already-authenticated users out of auth form flow.
    if (getToken()) onNavigate("/home");
  }, [onNavigate]);

  /** Clears transient notices before a fresh auth request. */
  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  /**
   * Extracts the most useful error string from an API error response.
   * @param {Error}  error
   * @param {string} fallbackMessage
   * @returns {string}
   */
  const formatApiError = (error, fallbackMessage) => {
    const apiError = error?.response?.data?.error;
    const apiDetails = error?.response?.data?.details;
    if (apiError && apiDetails) return `${apiError} (${apiDetails})`;
    return apiError || fallbackMessage;
  };

  /**
   * Persists the auth token and navigates to /home.
   * @param {string}      token
   * @param {string|null} userId
   */
  const finalizeLogin = (token, userId = null) => {
    setToken(token);
    if (userId) setUserId(userId);
    onNavigate("/home");
  };

  /**
   * Switch to Sign In mode. Called by SignUpFlow when it detects SIGNIN_REQUIRED
   * (the phone already has an account).
   * @param {string} [initialPhone] - kept for call-site signature compatibility;
   *   no longer used to pre-fill SignInFlow (the sessionStorage prefill hand-off
   *   was removed — SignInFlow manages its own phone state independently now).
   */
  const switchToSignin = (initialPhone) => {
    clearMessages();
    setAuthMode("signin");
    void initialPhone; // unused — see @param note above
  };

  /**
   * Switch to Sign Up mode. Called by SignInFlow when it detects SIGNUP_REQUIRED
   * (the phone hasn't completed signup yet).
   * @param {string} [initialPhone] - kept for call-site signature compatibility;
   *   no longer used to pre-fill SignUpFlow (see switchToSignin's note above).
   */
  const switchToSignup = (initialPhone) => {
    clearMessages();
    setAuthMode("signup");
    void initialPhone; // unused — see @param note above
  };

  return (
    <main className="auth-page">
      <section className="auth-layout" aria-label="Community login panel">
        <div className="auth-context">
          <ShieldCheck className="auth-context-watermark" size={120} strokeWidth={1} aria-hidden="true" />
          <p className="eyebrow">Private community access</p>
          <h1>Join when you are ready</h1>
          <p>
            Use a phone-based secure login to enter community support spaces and continue toward protected
            areas of the platform.
          </p>
          <div className="auth-note-block">
            <strong>Discreet by design</strong>
            <span>Quick Exit clears the local session and moves away from this page immediately.</span>
          </div>
        </div>

        <div className="form-panel">
          <p className="eyebrow auth-brand-eyebrow">
            <SikikaLogo size={22} decorative />
            <span>Sikika</span>
          </p>
          <h2>{authMode === "signin" ? "Sign In" : "Create Account"}</h2>
          <p className="subtext">
            Sign in with password or OTP, or sign up by verifying an OTP then creating your password.
          </p>

          <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode" style={{ "--tab-offset": authMode === "signup" ? 1 : 0 }}>
            <button
              id="tab-signin"
              role="tab"
              aria-selected={authMode === "signin"}
              aria-controls="tabpanel-signin"
              tabIndex={authMode === "signin" ? 0 : -1}
              type="button"
              className={`auth-mode-btn ${authMode === "signin" ? "active" : ""}`}
              onClick={() => { clearMessages(); setAuthMode("signin"); }}
              disabled={loading}
            >
              Sign In
            </button>
            <button
              id="tab-signup"
              role="tab"
              aria-selected={authMode === "signup"}
              aria-controls="tabpanel-signup"
              tabIndex={authMode === "signup" ? 0 : -1}
              type="button"
              className={`auth-mode-btn ${authMode === "signup" ? "active" : ""}`}
              onClick={() => { clearMessages(); setAuthMode("signup"); }}
              disabled={loading}
            >
              Sign Up
            </button>
          </div>

          {errorMessage && (
            <p className="feedback feedback-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className="feedback feedback-success" role="status">
              <CheckCircle2 size={15} aria-hidden="true" />
              {successMessage}
            </p>
          )}

          {authMode === "signin" ? (
            <SignInFlow
              key="signin"
              loading={loading}
              setLoading={setLoading}
              setErrorMessage={setErrorMessage}
              setSuccessMessage={setSuccessMessage}
              clearMessages={clearMessages}
              finalizeLogin={finalizeLogin}
              formatApiError={formatApiError}
              onSwitchToSignup={switchToSignup}
            />
          ) : (
            <SignUpFlow
              key="signup"
              loading={loading}
              setLoading={setLoading}
              setErrorMessage={setErrorMessage}
              setSuccessMessage={setSuccessMessage}
              clearMessages={clearMessages}
              finalizeLogin={finalizeLogin}
              formatApiError={formatApiError}
              onSwitchToSignin={switchToSignin}
            />
          )}
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
