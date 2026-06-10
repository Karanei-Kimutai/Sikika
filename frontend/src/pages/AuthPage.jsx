import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Intent flags mirror backend enums so each OTP request/verify call is explicit.
const AUTH_INTENTS = {
  SIGNIN_OTP: "SIGNIN_OTP",
  SIGNUP_OTP: "SIGNUP_OTP"
};

/**
 * Community authentication page.
 *
 * This page supports two auth paths under /join while public pages remain open:
 *
 * Flow summary:
 * 1. Existing users log in with phone + password.
 * 2. First-time users request an OTP, verify it, and set an initial password.
 * 3. Successful verification/login stores the JWT in localStorage.
 */
function AuthPage({ onNavigate }) {
  const [authMode, setAuthMode] = useState("signin");
  const [signinMethod, setSigninMethod] = useState("password");
  const [signinOtpStep, setSigninOtpStep] = useState("request");
  const [signupStep, setSignupStep] = useState("request");

  // Sign in fields.
  const [signinPhone, setSigninPhone] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signinOtp, setSigninOtp] = useState("");
  const [showSigninPassword, setShowSigninPassword] = useState(false);

  // Sign up fields.
  const [signupPhone, setSignupPhone] = useState("");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot/reset password flow.
  const [showResetFlow, setShowResetFlow] = useState(false);
  const [resetStep, setResetStep] = useState("request");
  const [resetPhone, setResetPhone] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Shared UI state for all auth actions.
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    // Keep already-authenticated users out of auth form flow.
    if (localStorage.getItem("authToken")) {
      onNavigate("/home");
    }
  }, [onNavigate]);

  /**
   * Derived validation flags keep disabled-button logic readable in JSX.
   * These are light client-side checks only; the backend still owns real auth validation.
   */
  const canSubmitSigninPhone = useMemo(() => signinPhone.trim().length >= 10, [signinPhone]);
  const canSubmitSigninPassword = useMemo(() => signinPassword.trim().length >= 8, [signinPassword]);
  const canSubmitSigninOtp = useMemo(() => signinOtp.trim().length === 4, [signinOtp]);
  const canSubmitSignupPhone = useMemo(() => signupPhone.trim().length >= 10, [signupPhone]);
  const canSubmitSignupOtp = useMemo(() => signupOtp.trim().length === 4, [signupOtp]);
  const canSubmitSignupPassword = useMemo(() => signupPassword.trim().length >= 8, [signupPassword]);
  const canSubmitResetPhone = useMemo(() => resetPhone.trim().length >= 10, [resetPhone]);
  const canSubmitResetOtp = useMemo(() => resetOtp.trim().length === 4, [resetOtp]);
  const canSubmitResetPassword = useMemo(() => resetNewPassword.trim().length >= 8, [resetNewPassword]);

  // Reset transient notices before a fresh auth request starts.
  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  const finalizeLogin = (token, userId = null) => {
    // Persist token and identity for app session continuity across reloads.
    localStorage.setItem("authToken", token);
    if (userId) localStorage.setItem("userId", userId);
    onNavigate("/home");
  };

  // Switches to Sign In mode and resets Sign In transient state.
  const switchToSignin = (method = "password") => {
    clearMessages();
    setAuthMode("signin");
    setSigninMethod(method);
    setSigninOtpStep("request");
    setSigninOtp("");
    setShowResetFlow(false);
    setResetStep("request");
  };

  // Switches to Sign Up mode and clears stale OTP/password fields.
  const switchToSignup = () => {
    clearMessages();
    setAuthMode("signup");
    setSignupStep("request");
    setSignupOtp("");
    setSignupPassword("");
    setShowResetFlow(false);
    setResetStep("request");
  };

  // Opens forgot-password flow inside Sign In card.
  const openResetFlow = () => {
    clearMessages();
    setShowResetFlow(true);
    setResetStep("request");
    setResetPhone(signinPhone || "");
    setResetOtp("");
    setResetNewPassword("");
  };

  // Step 1 reset: request OTP for password reset.
  const requestResetOtp = async () => {
    if (!canSubmitResetPhone) {
      setErrorMessage("Enter a valid mobile number including country code.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/forgot-password/request`, {
        phoneNumber: resetPhone.trim()
      });

      if (response.data.developmentOtp) {
        setResetOtp(response.data.developmentOtp);
      }

      setResetStep("verify");
      setSuccessMessage(
        response.data.developmentOtp
          ? "Development reset OTP loaded. Enter it and set your new password."
          : "Password reset code sent. Enter it and set a new password."
      );
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not request password reset.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 reset: verify reset OTP and write new password.
  const completePasswordReset = async () => {
    if (!canSubmitResetOtp || !canSubmitResetPassword || !canSubmitResetPhone) {
      setErrorMessage("Enter your number, OTP, and a new password (minimum 8 characters).");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      await axios.post(`${API_BASE_URL}/api/auth/forgot-password/reset`, {
        phoneNumber: resetPhone.trim(),
        otp: resetOtp.trim(),
        newPassword: resetNewPassword.trim()
      });

      setShowResetFlow(false);
      setResetStep("request");
      setSigninPhone(resetPhone.trim());
      setSigninPassword("");
      setSuccessMessage("Password reset successful. You can now sign in with your new password.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Password reset failed.");
    } finally {
      setLoading(false);
    }
  };

  // Step 1 signup: issue OTP for account creation.
  const requestSignupOtp = async () => {
    if (!canSubmitSignupPhone) {
      setErrorMessage("Enter a valid mobile number including country code.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/request-otp`, {
        phoneNumber: signupPhone.trim(),
        authIntent: AUTH_INTENTS.SIGNUP_OTP
      });

      if (response.data.developmentOtp) {
        setSignupOtp(response.data.developmentOtp);
      }

      setSignupStep("verify");
      setSuccessMessage(
        response.data.developmentOtp
          ? "Development OTP loaded. Confirm it and set your password."
          : "A secure code has been sent to your phone. Verify it and set your password."
      );
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        setSigninPhone(signupPhone.trim());
        switchToSignin("otp");
        setErrorMessage("This phone already has an account. Sign in with OTP or password.");
      } else {
        setErrorMessage(error.response?.data?.error || "Could not send access code. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2 signup: verify OTP and create first password, then auto-login.
  const completeSignup = async () => {
    if (!canSubmitSignupOtp || !canSubmitSignupPassword) {
      setErrorMessage("Enter the 4-digit code and a new password (minimum 8 characters).");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
        phoneNumber: signupPhone.trim(),
        otp: signupOtp.trim(),
        password: signupPassword.trim(),
        authIntent: AUTH_INTENTS.SIGNUP_OTP
      });

      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        setSigninPhone(signupPhone.trim());
        switchToSignin("otp");
        setErrorMessage("This account already has a password. Please sign in.");
      } else {
        setErrorMessage(error.response?.data?.error || "Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Classic password sign in path for existing users.
  const loginWithPassword = async () => {
    if (!canSubmitSigninPhone || !canSubmitSigninPassword) {
      setErrorMessage("Enter your mobile number and password (minimum 8 characters).");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/login-password`, {
        phoneNumber: signinPhone.trim(),
        password: signinPassword.trim()
      });

      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Password login failed. Check your phone number and password.");
    } finally {
      setLoading(false);
    }
  };

  // OTP sign in step 1: request sign-in OTP for existing account.
  const requestSigninOtp = async () => {
    if (!canSubmitSigninPhone) {
      setErrorMessage("Enter a valid mobile number including country code.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/request-otp`, {
        phoneNumber: signinPhone.trim(),
        authIntent: AUTH_INTENTS.SIGNIN_OTP
      });

      if (response.data.developmentOtp) {
        setSigninOtp(response.data.developmentOtp);
      }

      setSigninOtpStep("verify");
      setSuccessMessage(
        response.data.developmentOtp
          ? "Development OTP loaded. Enter it to complete sign in."
          : "A secure sign-in code has been sent to your phone. Enter it below."
      );
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNUP_REQUIRED") {
        setSignupPhone(signinPhone.trim());
        switchToSignup();
        setErrorMessage("This phone number has not completed signup yet. Create your account first.");
      } else {
        setErrorMessage(error.response?.data?.error || "Could not send OTP for sign in.");
      }
    } finally {
      setLoading(false);
    }
  };

  // OTP sign in step 2: verify code and authenticate.
  const verifySigninOtp = async () => {
    if (!canSubmitSigninOtp || !canSubmitSigninPhone) {
      setErrorMessage("Enter your mobile number and the 4-digit OTP code.");
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
        phoneNumber: signinPhone.trim(),
        otp: signinOtp.trim(),
        authIntent: AUTH_INTENTS.SIGNIN_OTP
      });

      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNUP_REQUIRED") {
        setSignupPhone(signinPhone.trim());
        switchToSignup();
        setErrorMessage("This phone number has not completed signup yet. Create your account first.");
      } else {
        setErrorMessage(error.response?.data?.error || "OTP sign in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Resends OTP based on active flow branch.
  const resendCode = async () => {
    if (authMode === "signup") {
      setSignupOtp("");
      await requestSignupOtp();
      return;
    }

    if (authMode === "signin" && signinMethod === "otp") {
      setSigninOtp("");
      await requestSigninOtp();
    }
  };

  return (
    <main className="auth-page">
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
          <h2>{authMode === "signin" ? "Sign In" : "Create Account"}</h2>
          <p className="subtext">
            Sign in with password or OTP, or sign up by verifying an OTP then creating your password.
          </p>

          <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={`auth-mode-btn ${authMode === "signin" ? "active" : ""}`}
              onClick={switchToSignin}
              disabled={loading}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-mode-btn ${authMode === "signup" ? "active" : ""}`}
              onClick={switchToSignup}
              disabled={loading}
            >
              Sign Up
            </button>
          </div>

          {errorMessage && <p className="feedback feedback-error">{errorMessage}</p>}
          {successMessage && <p className="feedback feedback-success">{successMessage}</p>}

          {authMode === "signin" ? (
            <div className="field-group auth-step-card">
              <p className="auth-step-heading">Existing Account</p>
              <div className="auth-method-switch" role="tablist" aria-label="Sign in method">
                <button
                  type="button"
                  className={`auth-method-btn ${signinMethod === "password" ? "active" : ""}`}
                  onClick={() => {
                    clearMessages();
                    setSigninMethod("password");
                  }}
                  disabled={loading}
                >
                  Password
                </button>
                <button
                  type="button"
                  className={`auth-method-btn ${signinMethod === "otp" ? "active" : ""}`}
                  onClick={() => {
                    clearMessages();
                    setSigninMethod("otp");
                    setSigninOtpStep("request");
                    setSigninOtp("");
                  }}
                  disabled={loading}
                >
                  OTP
                </button>
              </div>

              <label htmlFor="signinPhone">Mobile Number</label>
              <input
                id="signinPhone"
                type="tel"
                placeholder="e.g. +2547XXXXXXXX"
                value={signinPhone}
                onChange={(event) => setSigninPhone(event.target.value)}
                autoComplete="off"
                name="signin-phone-input"
                data-lpignore="true"
              />

              {showResetFlow ? (
                <>
                  <p className="auth-mini-guide">Reset your password using OTP verification.</p>
                  <label htmlFor="resetPhone">Mobile Number</label>
                  <input
                    id="resetPhone"
                    type="tel"
                    placeholder="e.g. +2547XXXXXXXX"
                    value={resetPhone}
                    onChange={(event) => setResetPhone(event.target.value)}
                    autoComplete="off"
                    name="reset-phone-input"
                    data-lpignore="true"
                  />

                  {resetStep === "request" ? (
                    <button
                      type="button"
                      className="primary-btn auth-cta-btn"
                      onClick={requestResetOtp}
                      disabled={loading || !canSubmitResetPhone}
                    >
                      {loading ? "Sending reset code..." : "Send Reset OTP"}
                    </button>
                  ) : (
                    <>
                      <label htmlFor="resetOtp">Enter 4-Digit Code</label>
                      <input
                        id="resetOtp"
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="----"
                        className="otp-input"
                        value={resetOtp}
                        onChange={(event) => setResetOtp(event.target.value.replace(/\D/g, ""))}
                        autoComplete="one-time-code"
                      />

                      <label htmlFor="resetNewPassword">New Password</label>
                      <div className="password-input-wrap">
                        <input
                          id="resetNewPassword"
                          type={showResetPassword ? "text" : "password"}
                          placeholder="Minimum 8 characters"
                          value={resetNewPassword}
                          onChange={(event) => setResetNewPassword(event.target.value)}
                          autoComplete="off"
                          name="reset-password-input"
                          data-lpignore="true"
                        />
                        <button
                          type="button"
                          className="password-toggle-btn"
                          onClick={() => setShowResetPassword((value) => !value)}
                        >
                          {showResetPassword ? "Hide" : "Show"}
                        </button>
                      </div>

                      <button
                        type="button"
                        className="primary-btn auth-verify-btn"
                        onClick={completePasswordReset}
                        disabled={loading || !canSubmitResetPhone || !canSubmitResetOtp || !canSubmitResetPassword}
                      >
                        {loading ? "Resetting password..." : "Verify OTP & Reset Password"}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      clearMessages();
                      setShowResetFlow(false);
                      setResetStep("request");
                    }}
                    disabled={loading}
                  >
                    Back To Sign In
                  </button>
                </>
              ) : signinMethod === "password" ? (
                <>
                  <label htmlFor="signinPassword">Password</label>
                  <div className="password-input-wrap">
                    <input
                      id="signinPassword"
                      type={showSigninPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={signinPassword}
                      onChange={(event) => setSigninPassword(event.target.value)}
                      autoComplete="off"
                      name="signin-password-input"
                      data-lpignore="true"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowSigninPassword((value) => !value)}
                    >
                      {showSigninPassword ? "Hide" : "Show"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="primary-btn auth-cta-btn"
                    onClick={loginWithPassword}
                    disabled={loading || !canSubmitSigninPhone || !canSubmitSigninPassword}
                  >
                    {loading ? "Signing in..." : "Sign In With Password"}
                  </button>

                  <button type="button" className="link-btn" onClick={openResetFlow} disabled={loading}>
                    Forgot Password?
                  </button>
                </>
              ) : signinOtpStep === "request" ? (
                <>
                  <button
                    type="button"
                    className="primary-btn auth-cta-btn"
                    onClick={requestSigninOtp}
                    disabled={loading || !canSubmitSigninPhone}
                  >
                    {loading ? "Sending code..." : "Send Sign-In OTP"}
                  </button>
                </>
              ) : (
                <>
                  <label htmlFor="signinOtp">Enter 4-Digit Code</label>
                  <input
                    id="signinOtp"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="----"
                    className="otp-input"
                    value={signinOtp}
                    onChange={(event) => setSigninOtp(event.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                  />

                  <button
                    type="button"
                    className="primary-btn auth-verify-btn"
                    onClick={verifySigninOtp}
                    disabled={loading || !canSubmitSigninPhone || !canSubmitSigninOtp}
                  >
                    {loading ? "Verifying..." : "Verify OTP & Sign In"}
                  </button>

                  <button type="button" className="link-btn" onClick={resendCode} disabled={loading}>
                    Resend Code
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      clearMessages();
                      setSigninOtpStep("request");
                      setSigninOtp("");
                    }}
                    disabled={loading}
                  >
                    Back To Send OTP
                  </button>
                </>
              )}

              <button type="button" className="link-btn" onClick={switchToSignup} disabled={loading}>
                New here? Go to Sign Up
              </button>
            </div>
          ) : (
            <div className="field-group auth-step-card">
              <p className="auth-step-heading">New Account Setup</p>

              {signupStep === "request" ? (
                <>
                  <label htmlFor="signupPhone">Mobile Number</label>
                  <input
                    id="signupPhone"
                    type="tel"
                    placeholder="e.g. +2547XXXXXXXX"
                    value={signupPhone}
                    onChange={(event) => setSignupPhone(event.target.value)}
                    autoComplete="off"
                    name="signup-phone-input"
                    data-lpignore="true"
                  />

                  <button
                    type="button"
                    className="primary-btn auth-cta-btn"
                    onClick={requestSignupOtp}
                    disabled={loading || !canSubmitSignupPhone}
                  >
                    {loading ? "Sending code..." : "Send OTP Code"}
                  </button>
                </>
              ) : (
                <>
                  <p className="auth-mini-guide">
                    Step 2 of 2: Verify your OTP and create your password.
                  </p>
                  <label htmlFor="signupOtp">Enter 4-Digit Code</label>
                  <input
                    id="signupOtp"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="----"
                    className="otp-input"
                    value={signupOtp}
                    onChange={(event) => setSignupOtp(event.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                  />

                  <label htmlFor="signupPassword">Create Password</label>
                  <div className="password-input-wrap">
                    <input
                      id="signupPassword"
                      type={showSignupPassword ? "text" : "password"}
                      placeholder="Minimum 8 characters"
                      value={signupPassword}
                      onChange={(event) => setSignupPassword(event.target.value)}
                      autoComplete="off"
                      name="signup-password-input"
                      data-lpignore="true"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowSignupPassword((value) => !value)}
                    >
                      {showSignupPassword ? "Hide" : "Show"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="primary-btn auth-verify-btn"
                    onClick={completeSignup}
                    disabled={loading || !canSubmitSignupOtp || !canSubmitSignupPassword}
                  >
                    {loading ? "Creating account..." : "Verify OTP & Create Password"}
                  </button>

                  <button type="button" className="link-btn" onClick={resendCode} disabled={loading}>
                    Resend Code
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      clearMessages();
                      setSignupStep("request");
                      setSignupOtp("");
                      setSignupPassword("");
                    }}
                    disabled={loading}
                  >
                    Change Number
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
