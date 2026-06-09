import { useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const QUICK_EXIT_URL = "https://www.google.com";

/**
 * Community authentication page.
 *
 * This keeps the existing OTP/password flow available under /join while the
 * public landing and library pages remain accessible without authentication.
 *
 * Flow summary:
 * 1. User enters a phone number.
 * 2. User chooses either OTP login or password login.
 * 3. OTP users move from the "phone" step to the "otp" step after requesting a code.
 * 4. Successful OTP/password verification stores the JWT in localStorage.
 * 5. Quick Exit clears local auth state and redirects away from the platform.
 */
function AuthPage({ onNavigate }) {
  /**
   * Authentication state is initialized from localStorage so a page refresh does
   * not immediately hide the signed-in UI after a successful login.
   */
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem("authToken")));

  /**
   * step controls which part of the form is displayed:
   * - "phone": collect phone number and optional password.
   * - "otp": collect the code sent to the user's phone.
   */
  const [step, setStep] = useState("phone");

  /**
   * loginMethod changes the first step between two backend flows:
   * - OTP: POST /api/auth/request-otp, then POST /api/auth/verify-otp.
   * - Password: POST /api/auth/login-password directly.
   */
  const [loginMethod, setLoginMethod] = useState("otp");

  // Form field state is intentionally kept local to this page.
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");

  // Shared UI state for all auth actions.
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [devOtpHint, setDevOtpHint] = useState("");
  const [tokenPreview, setTokenPreview] = useState("");

  /**
   * Derived validation flags keep disabled-button logic readable in JSX.
   * These are light client-side checks only; the backend still owns real auth validation.
   */
  const canSubmitPhone = useMemo(() => phoneNumber.trim().length >= 10, [phoneNumber]);
  const canSubmitOtp = useMemo(() => otp.trim().length === 4, [otp]);
  const canSubmitPassword = useMemo(() => password.trim().length >= 8, [password]);

  // Reset transient notices before a fresh auth request starts.
  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
    setDevOtpHint("");
  };

  /**
   * Persist the JWT locally so refreshes keep the user in an authenticated state.
   * tokenPreview is deliberately shortened so the UI can confirm storage without
   * rendering the full credential.
   */
  const finalizeLogin = (token, message, userId = null) => {
    localStorage.setItem("authToken", token);
    if (userId) localStorage.setItem("userId", userId);
    setTokenPreview(`${token.slice(0, 18)}...`);
    setSuccessMessage(message);
    setIsAuthenticated(true);
  };

  /**
   * Request an OTP for the current phone number.
   *
   * In normal mode, the backend sends an SMS and the UI advances to the OTP step.
   * In development mode, the backend may return developmentOtp so local testing
   * can auto-verify without depending on SMS delivery.
   */
  const requestOtp = async () => {
    if (!canSubmitPhone) {
      setErrorMessage("Enter a valid mobile number including country code.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/request-otp`, {
        phoneNumber: phoneNumber.trim()
      });

      /**
       * Development convenience path:
       * the controller can return a one-time code when SKIP_SMS_IN_DEV is enabled.
       * We immediately verify it so local demos land in the same authenticated state
       * as a real OTP verification.
       */
      if (response.data.developmentOtp) {
        const autoVerifyResponse = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
          phoneNumber: phoneNumber.trim(),
          otp: response.data.developmentOtp
        });

        finalizeLogin(
          autoVerifyResponse.data.token,
          "Development mode: auto-verified and logged in successfully.",
          autoVerifyResponse.data.userId
        );
        return;
      }

      // Production-like path: wait for the user to type the code they received.
      setStep("otp");
      setSuccessMessage("A secure code has been sent to your phone.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not send access code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Verify the user-entered OTP and establish a frontend session with the
   * returned JWT. The backend is responsible for checking expiry and correctness.
   */
  const verifyOtp = async () => {
    if (!canSubmitOtp) {
      setErrorMessage("Enter the 4-digit code sent to your phone.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
        phoneNumber: phoneNumber.trim(),
        otp: otp.trim()
      });

      finalizeLogin(
        response.data.token,
         "Secure login successful. You can now continue safely.",
         response.data.userId);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Password login is an alternate entry path for users who already configured
   * a password. It shares finalizeLogin so the post-login UI stays consistent
   * with the OTP flow.
   */
  const loginWithPassword = async () => {
    if (!canSubmitPhone || !canSubmitPassword) {
      setErrorMessage("Enter your mobile number and password (minimum 8 characters).");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/login-password`, {
        phoneNumber: phoneNumber.trim(),
        password: password.trim()
      });

      finalizeLogin(
        response.data.token,
        "Password login successful. You can now continue safely.",
        response.data.userId
      );
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Password login failed. Try OTP or check your password.");
    } finally {
      setLoading(false);
    }
  };

  // Resending starts a new OTP request and clears stale digits from the input.
  const resendCode = async () => {
    setOtp("");
    await requestOtp();
  };

  /**
   * Safety action: remove local auth state and leave the application immediately.
   * This is intentionally more aggressive than logout because it navigates away
   * from the support platform after clearing sensitive local UI/session state.
   */
  const quickExit = () => {
    localStorage.removeItem("authToken");
    setIsAuthenticated(false);
    setStep("phone");
    setLoginMethod("otp");
    setPhoneNumber("");
    setOtp("");
    setPassword("");
    setTokenPreview("");
    clearMessages();
    window.location.replace(QUICK_EXIT_URL);
  };

  /**
   * Standard sign-out keeps the user inside the app shell while clearing the
   * saved token and sensitive form fields.
   */
  const logout = () => {
    localStorage.removeItem("authToken");
    setIsAuthenticated(false);
    setStep("phone");
    setLoginMethod("otp");
    setOtp("");
    setPassword("");
    setTokenPreview("");
    setSuccessMessage("You have been signed out safely.");
  };

  return (
    <main className="auth-page">
      <button type="button" className="quick-exit" onClick={quickExit}>
        Quick Exit
      </button>

      <section className="auth-layout" aria-label="Community login panel">
        <div className="auth-context">
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
          <p className="eyebrow">GBV Support Platform</p>
          <h2>
            {isAuthenticated ? "You Are Securely Signed In" : step === "phone" ? "Community Login" : "Welcome Back"}
          </h2>
          <p className="subtext">
            A discreet support and reporting platform that helps survivors access help safely.
          </p>

          {errorMessage && <p className="feedback feedback-error">{errorMessage}</p>}
          {successMessage && <p className="feedback feedback-success">{successMessage}</p>}
          {devOtpHint && <p className="feedback feedback-hint">{devOtpHint}</p>}

          {/* Authenticated users see a compact session state instead of the login form. */}
          {isAuthenticated ? (
            <div className="field-group">
              <p className="auth-note">Your secure session is active. You can now continue to protected areas.</p>
              <button type="button" className="primary-btn" onClick={() => onNavigate("/home")}>
                Continue To Home
              </button>
              <button type="button" className="link-btn" onClick={logout}>
                Sign Out
              </button>
            </div>
          ) : step === "phone" ? (
            /**
             * First unauthenticated step:
             * collect the phone number and, only when password mode is selected,
             * collect the password field as well.
             */
            <div className="field-group">
              <label htmlFor="phoneNumber">Mobile Number</label>
              <input
                id="phoneNumber"
                type="tel"
                placeholder="e.g. +2547XXXXXXXX"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                autoComplete="tel"
              />

              {loginMethod === "password" && (
                <>
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </>
              )}

              <button
                type="button"
                className="primary-btn"
                onClick={loginMethod === "otp" ? requestOtp : loginWithPassword}
                disabled={loading || !canSubmitPhone || (loginMethod === "password" && !canSubmitPassword)}
              >
                {loading
                  ? "Please wait..."
                  : loginMethod === "otp"
                    ? "Send Access Code"
                    : "Login With Password"}
              </button>

              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  clearMessages();
                  setLoginMethod((current) => (current === "otp" ? "password" : "otp"));
                }}
                disabled={loading}
              >
                {loginMethod === "otp" ? "Use Password Instead" : "Use OTP Instead"}
              </button>
            </div>
          ) : (
            /**
             * Second OTP-only step:
             * collect numeric digits, verify them, or restart the OTP request.
             */
            <div className="field-group">
              <label htmlFor="otp">Enter 4-Digit Code</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="----"
                className="otp-input"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              />
              <button
                type="button"
                className="primary-btn"
                onClick={verifyOtp}
                disabled={loading || !canSubmitOtp}
              >
                {loading ? "Verifying..." : "Verify & Secure Login"}
              </button>
              <button type="button" className="link-btn" onClick={resendCode} disabled={loading}>
                Resend Code
              </button>
            </div>
          )}

          {tokenPreview && <p className="token-preview">Token saved locally: {tokenPreview}</p>}
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
