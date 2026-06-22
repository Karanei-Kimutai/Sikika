import { useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * SignInFlow
 * ----------
 * Renders the Sign In tab panel including:
 * - Password sign-in, with OTP enforced as a mandatory 2FA step after a
 *   successful password match (no separate OTP-only login method)
 * - Forgot/reset password sub-flow
 * - First-login forced password reset for staff provisioned by NGO admins
 *
 * @param {object}   props
 * @param {boolean}  props.loading
 * @param {Function} props.setLoading
 * @param {Function} props.setErrorMessage
 * @param {Function} props.setSuccessMessage
 * @param {Function} props.clearMessages
 * @param {Function} props.finalizeLogin  - (token, userId) → navigates to /home
 * @param {Function} props.formatApiError - (error, fallback) → string
 * @param {Function} props.onSwitchToSignup - (initialPhone?) → switch parent to signup mode
 */
export default function SignInFlow({
  loading, setLoading, setErrorMessage, setSuccessMessage, clearMessages,
  finalizeLogin, onSwitchToSignup
}) {
  const [signinPhone, setSigninPhone] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [showSigninPassword, setShowSigninPassword] = useState(false);
  const [signinStep, setSigninStep] = useState("password");
  const [signinTwoFactorOtp, setSigninTwoFactorOtp] = useState("");

  const [showResetFlow, setShowResetFlow] = useState(false);
  const [resetStep, setResetStep] = useState("request");
  const [resetPhone, setResetPhone] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [showFirstLoginResetFlow, setShowFirstLoginResetFlow] = useState(false);
  const [firstLoginResetPassword, setFirstLoginResetPassword] = useState("");
  const [showFirstLoginResetPassword, setShowFirstLoginResetPassword] = useState(false);
  const [firstLoginAuthToken, setFirstLoginAuthToken] = useState("");
  const [firstLoginUserId, setFirstLoginUserId] = useState("");

  const canSubmitSigninPhone = useMemo(() => signinPhone.trim().length >= 10, [signinPhone]);
  const canSubmitSigninPassword = useMemo(() => signinPassword.trim().length >= 8, [signinPassword]);
  const canSubmitTwoFactorOtp = useMemo(() => signinTwoFactorOtp.trim().length === 4, [signinTwoFactorOtp]);
  const canSubmitResetPhone = useMemo(() => resetPhone.trim().length >= 10, [resetPhone]);
  const canSubmitResetOtp = useMemo(() => resetOtp.trim().length === 4, [resetOtp]);
  const canSubmitResetPassword = useMemo(() => resetNewPassword.trim().length >= 8, [resetNewPassword]);
  const canSubmitFirstLoginResetPassword = useMemo(
    () => firstLoginResetPassword.trim().length >= 8, [firstLoginResetPassword]
  );

  /** Detects backend first-login signal and opens the forced-reset sub-flow. */
  const beginFirstLoginResetFlow = (responseData, phoneValue) => {
    setShowFirstLoginResetFlow(true);
    setFirstLoginAuthToken(responseData.token || "");
    setFirstLoginUserId(responseData.userId || "");
    setFirstLoginResetPassword("");
    setResetPhone(phoneValue || "");
    setSuccessMessage("First-time staff login detected. Set a new password to continue.");
  };

  const openResetFlow = () => {
    clearMessages();
    setShowResetFlow(true);
    setResetStep("request");
    setResetPhone(signinPhone || "");
    setResetOtp("");
    setResetNewPassword("");
  };

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
      if (response.data?.authStage === "PASSWORD_RESET_REQUIRED") {
        beginFirstLoginResetFlow(response.data, signinPhone.trim());
        return;
      }
      if (response.data?.authStage === "OTP_2FA_REQUIRED") {
        if (response.data.developmentOtp) setSigninTwoFactorOtp(response.data.developmentOtp);
        setSigninStep("twoFactor");
        setSuccessMessage(
          response.data.developmentOtp
            ? "Password verified. Development OTP loaded — confirm it to finish signing in."
            : "Password verified. Enter the OTP sent to your phone to finish signing in."
        );
        return;
      }
      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Password login failed. Check your phone number and password.");
    } finally {
      setLoading(false);
    }
  };

  const verifyTwoFactorOtp = async () => {
    if (!canSubmitTwoFactorOtp || !canSubmitSigninPhone) {
      setErrorMessage("Enter the 4-digit OTP sent to your phone.");
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-2fa`, {
        phoneNumber: signinPhone.trim(),
        otp: signinTwoFactorOtp.trim()
      });
      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "OTP verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resendTwoFactorOtp = async () => {
    setSigninTwoFactorOtp("");
    await loginWithPassword();
  };

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
      if (response.data.developmentOtp) setResetOtp(response.data.developmentOtp);
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

  const completeFirstLoginPasswordReset = async () => {
    if (!canSubmitFirstLoginResetPassword || !firstLoginAuthToken) {
      setErrorMessage("Enter a new password (minimum 8 characters).");
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      await axios.post(
        `${API_BASE_URL}/api/auth/set-password`,
        { password: firstLoginResetPassword.trim() },
        { headers: { Authorization: `Bearer ${firstLoginAuthToken}` } }
      );
      setShowFirstLoginResetFlow(false);
      finalizeLogin(firstLoginAuthToken, firstLoginUserId || null);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not update password.");
    } finally {
      setLoading(false);
    }
  };

  /** Routes form submit to the correct handler based on current sub-flow state. */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (showFirstLoginResetFlow) return completeFirstLoginPasswordReset();
    if (showResetFlow) return resetStep === "request" ? requestResetOtp() : completePasswordReset();
    if (signinStep === "twoFactor") return verifyTwoFactorOtp();
    return loginWithPassword();
  };

  return (
    <form
      id="tabpanel-signin"
      role="tabpanel"
      aria-labelledby="tab-signin"
      className="field-group auth-step-card"
      onSubmit={handleSubmit}
    >
      <p className="auth-step-heading">Existing Account</p>

      {showFirstLoginResetFlow ? (
        <>
          <p className="auth-mini-guide">For security, you must replace the temporary password before entering the platform.</p>
          <label htmlFor="firstLoginResetPassword">New Password</label>
          <div className="password-input-wrap">
            <input
              id="firstLoginResetPassword"
              type={showFirstLoginResetPassword ? "text" : "password"}
              placeholder="Minimum 8 characters"
              value={firstLoginResetPassword}
              onChange={(e) => setFirstLoginResetPassword(e.target.value)}
              autoComplete="off"
              name="first-login-reset-password-input"
              data-lpignore="true"
            />
            <button type="button" className="password-toggle-btn" onClick={() => setShowFirstLoginResetPassword((v) => !v)}>
              {showFirstLoginResetPassword ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" className="primary-btn auth-cta-btn" disabled={loading || !canSubmitFirstLoginResetPassword}>
            {loading ? "Updating password..." : "Update Password & Continue"}
          </button>
        </>
      ) : showResetFlow ? (
        <>
          <p className="auth-mini-guide">Reset your password using OTP verification.</p>
          <label htmlFor="resetPhone">Mobile Number</label>
          <input
            id="resetPhone"
            type="tel"
            placeholder="e.g. +2547XXXXXXXX"
            value={resetPhone}
            onChange={(e) => setResetPhone(e.target.value)}
            autoComplete="off"
            name="reset-phone-input"
            data-lpignore="true"
          />
          {resetStep === "request" ? (
            <button type="submit" className="primary-btn auth-cta-btn" disabled={loading || !canSubmitResetPhone}>
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
                onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
              />
              <label htmlFor="resetNewPassword">New Password</label>
              <div className="password-input-wrap">
                <input
                  id="resetNewPassword"
                  type={showResetPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  autoComplete="off"
                  name="reset-password-input"
                  data-lpignore="true"
                />
                <button type="button" className="password-toggle-btn" onClick={() => setShowResetPassword((v) => !v)}>
                  {showResetPassword ? "Hide" : "Show"}
                </button>
              </div>
              <button
                type="submit"
                className="primary-btn auth-verify-btn"
                disabled={loading || !canSubmitResetPhone || !canSubmitResetOtp || !canSubmitResetPassword}
              >
                {loading ? "Resetting password..." : "Verify OTP & Reset Password"}
              </button>
            </>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => { clearMessages(); setShowResetFlow(false); setResetStep("request"); }}
            disabled={loading}
          >
            Back To Sign In
          </button>
        </>
      ) : signinStep === "twoFactor" ? (
        <>
          <p className="auth-mini-guide">Step 2 of 2: Enter the OTP sent to your phone to finish signing in.</p>
          <label htmlFor="signinTwoFactorOtp">Enter 4-Digit Code</label>
          <input
            id="signinTwoFactorOtp"
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="----"
            className="otp-input"
            value={signinTwoFactorOtp}
            onChange={(e) => setSigninTwoFactorOtp(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
          />
          <button
            type="submit"
            className="primary-btn auth-verify-btn"
            disabled={loading || !canSubmitTwoFactorOtp}
            data-testid="signin-2fa-submit"
          >
            {loading ? "Verifying..." : "Verify & Sign In"}
          </button>
          <button type="button" className="link-btn" onClick={resendTwoFactorOtp} disabled={loading}>
            Resend Code
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => { clearMessages(); setSigninStep("password"); setSigninTwoFactorOtp(""); }}
            disabled={loading}
          >
            Back To Sign In
          </button>
        </>
      ) : (
        <>
          <label htmlFor="signinPhone">Mobile Number</label>
          <input
            id="signinPhone"
            type="tel"
            placeholder="e.g. +2547XXXXXXXX"
            value={signinPhone}
            onChange={(e) => setSigninPhone(e.target.value)}
            autoComplete="off"
            name="signin-phone-input"
            data-lpignore="true"
          />
          <label htmlFor="signinPassword">Password</label>
          <div className="password-input-wrap">
            <input
              id="signinPassword"
              type={showSigninPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={signinPassword}
              onChange={(e) => setSigninPassword(e.target.value)}
              autoComplete="off"
              name="signin-password-input"
              data-lpignore="true"
            />
            <button type="button" className="password-toggle-btn" onClick={() => setShowSigninPassword((v) => !v)}>
              {showSigninPassword ? "Hide" : "Show"}
            </button>
          </div>
          <button
            type="submit"
            className="primary-btn auth-cta-btn"
            disabled={loading || !canSubmitSigninPhone || !canSubmitSigninPassword}
            data-testid="signin-submit"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <button type="button" className="link-btn" onClick={openResetFlow} disabled={loading}>
            Forgot Password?
          </button>
          <button type="button" className="link-btn" onClick={() => onSwitchToSignup()} disabled={loading}>
            New here? Go to Sign Up
          </button>
        </>
      )}
    </form>
  );
}
