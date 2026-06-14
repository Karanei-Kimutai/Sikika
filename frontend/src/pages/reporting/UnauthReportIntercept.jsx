import { useState, useEffect } from "react";

/**
 * UnauthReportIntercept
 * ---------------------
 * Full-page intercept shown to unauthenticated visitors who reach /reports.
 * Offers account creation, sign-in, and an emergency contacts modal as a
 * safety escape hatch requiring no login.
 *
 * @param {{ onNavigate: Function }} props
 */
export default function UnauthReportIntercept({ onNavigate }) {
  const [showEmergencyContacts, setShowEmergencyContacts] = useState(false);

  useEffect(() => {
    if (!showEmergencyContacts) return;
    const handleEscape = (e) => { if (e.key === "Escape") setShowEmergencyContacts(false); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showEmergencyContacts]);

  return (
    <main className="library-page">
      <section className="emergency-intercept" aria-label="Account required to report">
        <p className="eyebrow">Incident reporting</p>
        <h1>You need an account to report an incident</h1>
        <p className="emergency-intercept-lead">
          Creating an account takes a few minutes and keeps your report confidential and
          secure. If you need immediate help, emergency contacts are available below.
        </p>

        <div className="emergency-intercept-actions">
          <button type="button" className="primary-btn" onClick={() => onNavigate("/join")}>
            Create Account
          </button>
          <button type="button" className="secondary-btn" onClick={() => setShowEmergencyContacts(true)}>
            View Emergency Contacts
          </button>
        </div>

        <button type="button" className="link-btn" onClick={() => onNavigate("/join")}>
          I already have an account — Sign In
        </button>
      </section>

      {showEmergencyContacts && (
        <div
          className="emergency-contacts-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Emergency contacts"
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmergencyContacts(false); }}
        >
          <div className="emergency-contacts-modal">
            <div className="emergency-contacts-header">
              <h2>Emergency Contacts</h2>
              <p>
                If you are in immediate danger, contact one of the services below. These
                lines are free and available 24 hours a day.
              </p>
            </div>
            <ul className="emergency-contact-list" aria-label="Crisis contact numbers">
              <li className="emergency-contact-card">
                <strong>Police</strong>
                <span><a href="tel:999">999</a> / <a href="tel:112">112</a></span>
              </li>
              <li className="emergency-contact-card">
                <strong>Childline Kenya</strong>
                <span><a href="tel:116">116</a></span>
              </li>
              <li className="emergency-contact-card">
                <strong>National GBV Hotline</strong>
                <span><a href="tel:1195">1195</a></span>
              </li>
            </ul>
            <button type="button" className="secondary-btn" onClick={() => setShowEmergencyContacts(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
