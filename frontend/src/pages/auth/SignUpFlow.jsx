import { useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const AUTH_INTENTS = { SIGNUP_OTP: "SIGNUP_OTP" };

/**
 * SignUpFlow
 * ----------
 * Renders the Sign Up tab panel:
 * - Step 1: phone number + send OTP
 * - Step 2: verify OTP, set password, fill profile details
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
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupNickname, setSignupNickname] = useState("");
  const [signupGender, setSignupGender] = useState("UNSPECIFIED");
  const [signupCounty, setSignupCounty] = useState("");

  const canSubmitSignupPhone = useMemo(() => signupPhone.trim().length >= 10, [signupPhone]);
  const canSubmitSignupOtp = useMemo(() => signupOtp.trim().length === 4, [signupOtp]);
  const canSubmitSignupPassword = useMemo(() => signupPassword.trim().length >= 8, [signupPassword]);

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
          ? "Development OTP loaded. Confirm it and set your password."
          : "A secure code has been sent to your phone. Verify it and set your password."
      );
    } catch (error) {
      if (error.response?.data?.authStage === "SIGNIN_REQUIRED") {
        onSwitchToSignin(signupPhone.trim());
        setErrorMessage("This phone already has an account. Sign in with OTP or password.");
      } else {
        setErrorMessage(formatApiError(error, "Could not send access code. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  const completeSignup = async () => {
    if (!canSubmitSignupOtp || !canSubmitSignupPassword) {
      setErrorMessage("Enter OTP, password, nickname, and county to complete signup.");
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
        phoneNumber: signupPhone.trim(),
        otp: signupOtp.trim(),
        password: signupPassword.trim(),
        authIntent: AUTH_INTENTS.SIGNUP_OTP,
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
        setErrorMessage(error.response?.data?.error || "Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    setSignupOtp("");
    await requestSignupOtp();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (signupStep === "request") return requestSignupOtp();
    return completeSignup();
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

      {signupStep === "request" ? (
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
          <button type="submit" className="primary-btn auth-cta-btn" disabled={loading || !canSubmitSignupPhone}>
            {loading ? "Sending code..." : "Send OTP Code"}
          </button>
        </>
      ) : (
        <>
          <p className="auth-mini-guide">Step 2 of 2: Verify your OTP and create your password.</p>
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
              setSignupNickname("");
              setSignupGender("UNSPECIFIED");
              setSignupCounty("");
            }}
            disabled={loading}
          >
            Change Number
          </button>
        </>
      )}
    </form>
  );
}
