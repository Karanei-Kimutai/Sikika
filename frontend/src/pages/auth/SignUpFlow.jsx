import { useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Auth intent discriminator sent in OTP requests so the backend can apply the
 * correct rate-limit bucket and OTP purpose validation.
 * @type {{ SIGNUP_OTP: string }}
 */
const AUTH_INTENTS = { SIGNUP_OTP: "SIGNUP_OTP" };

/**
 * SignUpFlow
 * ----------
 * Renders the Sign Up tab panel as a 3-step sequence:
 * - Step 1 (request): phone number → send OTP
 * - Step 2 (verify): enter OTP only → server issues a short-lived signup ticket
 * - Step 3 (details): set password + profile fields → complete-signup using the ticket
 *
 * @param {object}   props
 * @param {boolean}  props.loading
 * @param {Function} props.setLoading
 * @param {Function} props.setErrorMessage
 * @param {Function} props.setSuccessMessage
 * @param {Function} props.clearMessages
 * @param {Function} props.finalizeLogin  - (token, userId) → navigates to /home
 * @param {Function} props.formatApiError - (error, fallback) → string
 * @param {Function} props.onSwitchToSignin - (initialPhone?) → switch parent to signin mode
 */
export default function SignUpFlow({
  loading, setLoading, setErrorMessage, setSuccessMessage, clearMessages,
  finalizeLogin, formatApiError, onSwitchToSignin
}) {
  const [signupPhone, setSignupPhone] = useState("");
  const [signupStep, setSignupStep] = useState("request");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupTicket, setSignupTicket] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupNickname, setSignupNickname] = useState("");
  const [signupGender, setSignupGender] = useState("UNSPECIFIED");
  const [signupCounty, setSignupCounty] = useState("");

  const canSubmitSignupPhone = useMemo(() => signupPhone.trim().length >= 10, [signupPhone]);
  const canSubmitSignupOtp = useMemo(() => signupOtp.trim().length === 4, [signupOtp]);
  const canSubmitSignupPassword = useMemo(() => signupPassword.trim().length >= 8, [signupPassword]);

  /**
   * Step 1: Sends a SIGNUP_OTP to the entered phone number.
   * On success, transitions to the "verify" step. If the backend returns
   * `authStage=SIGNIN_REQUIRED`, the phone already has an account and the
   * parent is asked to switch to Sign In mode.
   * @returns {Promise<void>}
   */
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
      if (response.data.developmentOtp) setSignupOtp(response.data.developmentOtp);
      setSignupStep("verify");
      setSuccessMessage(
        response.data.developmentOtp
          ? "Development OTP loaded. Confirm it to continue."
          : "A secure code has been sent to your phone. Enter it to continue."
      );
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        onSwitchToSignin(signupPhone.trim());
        setErrorMessage("This phone already has an account. Please sign in.");
      } else {
        setErrorMessage(formatApiError(error, "Could not send access code. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 2: Verifies the OTP and exchanges it for a short-lived signup ticket.
   * The ticket is stored in component state and passed to `completeSignupDetails`
   * in step 3. On success, transitions to the "details" step.
   * @returns {Promise<void>}
   */
  const verifySignupOtp = async () => {
    if (!canSubmitSignupOtp) {
      setErrorMessage("Enter the 4-digit code sent to your phone.");
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
        phoneNumber: signupPhone.trim(),
        otp: signupOtp.trim()
      });
      setSignupTicket(response.data.signupTicket || "");
      setSignupStep("details");
      setSuccessMessage("Phone number verified. Now set your password and profile details.");
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        onSwitchToSignin(signupPhone.trim());
        setErrorMessage("This account already has a password. Please sign in.");
      } else {
        setErrorMessage(error.response?.data?.error || "Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 3: Sends the password, profile details, and signup ticket to
   * `complete-signup`. On success, calls `finalizeLogin` to persist the
   * issued JWT and navigate to /home.
   * @returns {Promise<void>}
   */
  const completeSignupDetails = async () => {
    if (!canSubmitSignupPassword) {
      setErrorMessage("Set a password with at least 8 characters.");
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/complete-signup`, {
        phoneNumber: signupPhone.trim(),
        signupTicket,
        password: signupPassword.trim(),
        profileDetails: {
          displayNickname: signupNickname.trim(),
          assignedGender: signupGender,
          residenceCounty: signupCounty.trim(),
          notificationsEnabled: true
        }
      });
      finalizeLogin(response.data.token, response.data.userId);
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        onSwitchToSignin(signupPhone.trim());
        setErrorMessage("This account already has a password. Please sign in.");
      } else {
        setErrorMessage(error.response?.data?.error || "Could not complete signup. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Resends the signup OTP by re-running step 1. Clears the current OTP
   * input so the user starts fresh.
   * @returns {Promise<void>}
   */
  const resendCode = async () => {
    setSignupOtp("");
    await requestSignupOtp();
  };

  /**
   * Resets the entire signup flow back to step 1 (phone entry), clearing
   * all intermediate state. Exposed as a "Back" action in the OTP/details steps.
   * @returns {void}
   */
  const resetToPhoneStep = () => {
    clearMessages();
    setSignupStep("request");
    setSignupOtp("");
    setSignupTicket("");
    setSignupPassword("");
    setSignupNickname("");
    setSignupGender("UNSPECIFIED");
    setSignupCounty("");
  };

  /**
   * Form submit dispatcher — routes to the appropriate step handler based on
   * the current `signupStep` value.
   * @param {React.FormEvent<HTMLFormElement>} e
   * @returns {Promise<void>|void}
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (signupStep === "request") return requestSignupOtp();
    if (signupStep === "verify") return verifySignupOtp();
    return completeSignupDetails();
  };

  return (
    <form
      id="tabpanel-signup"
      role="tabpanel"
      aria-labelledby="tab-signup"
      className="field-group auth-step-card"
      onSubmit={handleSubmit}
    >
      <p className="auth-step-heading">New Account Setup</p>

      {signupStep === "request" && (
        <>
          <label htmlFor="signupPhone">Mobile Number</label>
          <input
            id="signupPhone"
            type="tel"
            placeholder="e.g. +2547XXXXXXXX"
            value={signupPhone}
            onChange={(e) => setSignupPhone(e.target.value)}
            autoComplete="off"
            name="signup-phone-input"
            data-lpignore="true"
          />
          <button
            type="submit"
            className="primary-btn auth-cta-btn"
            disabled={loading || !canSubmitSignupPhone}
            data-testid="signup-send-otp"
          >
            {loading ? "Sending code..." : "Send OTP Code"}
          </button>
        </>
      )}

      {signupStep === "verify" && (
        <>
          <p className="auth-mini-guide">Step 2 of 3: Verify the code sent to your phone.</p>
          <label htmlFor="signupOtp">Enter 4-Digit Code</label>
          <input
            id="signupOtp"
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="----"
            className="otp-input"
            value={signupOtp}
            onChange={(e) => setSignupOtp(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
          />
          <button
            type="submit"
            className="primary-btn auth-verify-btn"
            disabled={loading || !canSubmitSignupOtp}
            data-testid="signup-verify-code"
          >
            {loading ? "Verifying..." : "Verify Code"}
          </button>
          <button type="button" className="link-btn" onClick={resendCode} disabled={loading}>
            Resend Code
          </button>
          <button type="button" className="link-btn" onClick={resetToPhoneStep} disabled={loading}>
            Change Number
          </button>
        </>
      )}

      {signupStep === "details" && (
        <>
          <p className="auth-mini-guide">Step 3 of 3: Set your password and profile details.</p>
          <label htmlFor="signupPassword">Create Password</label>
          <div className="password-input-wrap">
            <input
              id="signupPassword"
              type={showSignupPassword ? "text" : "password"}
              placeholder="Minimum 8 characters"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              autoComplete="off"
              name="signup-password-input"
              data-lpignore="true"
            />
            <button type="button" className="password-toggle-btn" onClick={() => setShowSignupPassword((v) => !v)}>
              {showSignupPassword ? "Hide" : "Show"}
            </button>
          </div>
          <label htmlFor="signupNickname">Preferred Nickname</label>
          <input
            id="signupNickname"
            type="text"
            placeholder="How should we identify you in community spaces?"
            value={signupNickname}
            onChange={(e) => setSignupNickname(e.target.value)}
            autoComplete="off"
          />
          <label htmlFor="signupGender">Gender</label>
          <select id="signupGender" value={signupGender} onChange={(e) => setSignupGender(e.target.value)}>
            <option value="UNSPECIFIED">Prefer not to say</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="NON_BINARY">Non-binary</option>
            <option value="OTHER">Other</option>
          </select>
          <label htmlFor="signupCounty">County</label>
          <input
            id="signupCounty"
            type="text"
            placeholder="e.g. Nairobi"
            value={signupCounty}
            onChange={(e) => setSignupCounty(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className="primary-btn auth-verify-btn"
            disabled={loading || !canSubmitSignupPassword}
            data-testid="signup-create-account"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
          <button type="button" className="link-btn" onClick={resetToPhoneStep} disabled={loading}>
            Change Number
          </button>
        </>
      )}
    </form>
  );
}
