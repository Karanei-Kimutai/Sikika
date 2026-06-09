import { useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

/**
 * Authentication landing page for Community Connect.
 *
 * Flow summary:
 * 1) User enters phone number.
 * 2) User chooses OTP or password login.
 * 3) On success, JWT is stored in localStorage.
 * 4) Quick Exit immediately clears local auth state and redirects away.
 */

const API_BASE_URL = "http://localhost:5000";
const QUICK_EXIT_URL = "https://www.google.com";

function App() {
  // Session and step state for the combined OTP/password authentication flow.
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem("authToken")));
  const [step, setStep] = useState("phone");
  const [loginMethod, setLoginMethod] = useState("otp");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [devOtpHint, setDevOtpHint] = useState("");
  const [tokenPreview, setTokenPreview] = useState("");

  const canSubmitPhone = useMemo(() => phoneNumber.trim().length >= 10, [phoneNumber]);
  const canSubmitOtp = useMemo(() => otp.trim().length === 4, [otp]);
  const canSubmitPassword = useMemo(() => password.trim().length >= 8, [password]);

  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
    setDevOtpHint("");
  };

  // Persist token, expose a small preview in UI, and switch into authenticated state.
  const finalizeLogin = (token, message) => {
    localStorage.setItem("authToken", token);
    setTokenPreview(`${token.slice(0, 18)}...`);
    setSuccessMessage(message);
    setIsAuthenticated(true);
  };

  // OTP request path. In local/dev mode, backend can return an OTP that is auto-verified.
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

      if (response.data.developmentOtp) {
        const autoVerifyResponse = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
          phoneNumber: phoneNumber.trim(),
          otp: response.data.developmentOtp
        });

        finalizeLogin(
          autoVerifyResponse.data.token,
          "Development mode: auto-verified and logged in successfully."
        );
        return;
      }

      setStep("otp");
      setSuccessMessage("A secure code has been sent to your phone.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Could not send access code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Verify user-provided OTP and establish authenticated session.
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

      finalizeLogin(response.data.token, "Secure login successful. You can now continue safely.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Password login path for users who already configured a password.
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

      finalizeLogin(response.data.token, "Password login successful. You can now continue safely.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Password login failed. Try OTP or check your password.");
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    setOtp("");
    await requestOtp();
  };

  // Safety action: clear local session and move user off the app immediately.
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

  // Standard sign-out while staying within the app shell.
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
    <main className="page-shell">
      <button type="button" className="quick-exit" onClick={quickExit}>
        Quick Exit
      </button>

      <section className="facade-card" aria-label="Community Connect login panel">
        <div className="illustration" aria-hidden="true">
          <div className="blob blob-one" />
          <div className="blob blob-two" />
          <div className="chat-card">Safe space</div>
          <div className="chat-card">Private support</div>
        </div>

        <div className="form-panel">
          <p className="eyebrow">Community Connect</p>
          <h1>
            {isAuthenticated ? "You Are Securely Signed In" : step === "phone" ? "Join the Community" : "Welcome Back"}
          </h1>
          <p className="subtext">
            A discreet support and reporting platform that helps survivors access help safely.
          </p>

          {errorMessage && <p className="feedback feedback-error">{errorMessage}</p>}
          {successMessage && <p className="feedback feedback-success">{successMessage}</p>}
          {devOtpHint && <p className="feedback feedback-hint">{devOtpHint}</p>}

          {isAuthenticated ? (
            <div className="field-group">
              <p className="auth-note">Your secure session is active. You can now continue to protected areas.</p>
              <button type="button" className="primary-btn" onClick={() => window.location.assign("/home")}>
                Continue To Home
              </button>
              <button type="button" className="link-btn" onClick={logout}>
                Sign Out
              </button>
            </div>
          ) : step === "phone" ? (
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

export default App;