import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, EyeOff, DoorOpen } from "lucide-react";
import SikikaLogo from "../components/SikikaLogo";
import { staggerIn, revealOnScroll } from "../utils/motion";

/**
 * LandingPage.jsx
 * ---------------
 * Public landing page shown to unregistered visitors at "/" and "/home".
 *
 * Sets the product tone and routes users toward the two primary entry actions:
 * browsing resources (no auth required) and joining the community (auth required).
 * All content sections have GSAP scroll-reveal animations gated behind the platform's
 * reduced-motion media query guard (see motion.js).
 */

/**
 * Feature-overview tiles shown in the "What we offer" section.
 * @type {Array<{ title: string, text: string }>}
 */
const offers = [
  {
    title: "Resource Library",
    text: "Browse practical guides, contacts, and safety planning material without creating an account."
  },
  {
    title: "Private Community",
    text: "Join a safer support space built around discreet access, verified help, and respectful moderation."
  },
  {
    title: "Guided Support",
    text: "Connect with counselling, legal, shelter, and emergency information from one platform."
  }
];

/**
 * Numbered onboarding steps listed in the "How it works" section.
 * @type {string[]}
 */
const steps = [
  "Browse public resources",
  "Join with a phone-based secure login",
  "Access support and community spaces"
];

/**
 * Trust-signal chips displayed below the hero call-to-action buttons.
 * Reassures survivors that browsing is safe before they commit to anything.
 * Each item has an icon component and a short label.
 *
 * @type {Array<{ icon: React.ComponentType, text: string }>}
 */
const trustSignals = [
  { icon: EyeOff, text: "Browse anonymously" },
  { icon: ShieldCheck, text: "No account needed to look around" },
  { icon: DoorOpen, text: "Quick Exit always available" }
];

/**
 * @param {object} props
 * @param {Function} props.onNavigate - App.jsx's pushState navigator; used for CTA and footer link clicks.
 * @returns {React.ReactElement}
 */
function LandingPage({ onNavigate }) {
  const heroRef = useRef(null);
  const offersRef = useRef(null);
  const stepsRef = useRef(null);

  // Staged hero entrance: copy column, then visual panel, for a deliberate,
  // calm reveal rather than everything appearing at once.
  useEffect(() => {
    if (!heroRef.current) return;
    const mm = staggerIn(heroRef.current.children, { y: 16, stagger: 0.12, duration: 0.55 });
    return () => mm.revert();
  }, []);

  // Offer tiles and steps reveal once as they scroll into view.
  useEffect(() => {
    if (!offersRef.current || !stepsRef.current) return;
    const mmOffers = revealOnScroll(offersRef.current.children, { stagger: 0.1 });
    const mmSteps = revealOnScroll(stepsRef.current.children, { stagger: 0.1 });
    return () => {
      mmOffers.revert();
      mmSteps.revert();
    };
  }, []);

  return (
    <main>
      <section className="hero-section" ref={heroRef}>
        <div className="hero-copy">
          <p className="eyebrow">Safe access to support</p>
          <h1 className="hero-brand-heading">
            <SikikaLogo size={48} decorative />
            <span>Sikika</span>
          </h1>
          <p className="hero-text">
            A discreet digital space where survivors and community members can find reliable
            resources, understand support options, and reach safer channels for help.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-btn" onClick={() => onNavigate("/library")}>
              Browse Resources <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="secondary-btn" onClick={() => onNavigate("/join")}>
              Join Community
            </button>
          </div>
          <ul className="hero-trust-strip">
            {trustSignals.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={16} aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="content-band" aria-labelledby="offer-heading">
        <div className="section-heading">
          <p className="eyebrow">What we offer</p>
          <h2 id="offer-heading">Support that is easy to find and careful with privacy</h2>
        </div>
        <div className="offer-grid" ref={offersRef}>
          {offers.map((offer) => (
            <article className="info-tile" key={offer.title}>
              <h3>{offer.title}</h3>
              <p>{offer.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="how-section" aria-labelledby="how-heading">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2 id="how-heading">Start with resources, continue only when you are ready</h2>
        </div>
        <ol className="steps-list" ref={stepsRef}>
          {steps.map((step, index) => (
            <li key={step}>
              <CheckCircle2 size={22} aria-hidden="true" className="step-check-icon" />
              <span className="step-number" aria-hidden="true">{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="site-footer">
        <div>
          <strong>Emergency Contacts</strong>
          <p>Police emergency: <a href="tel:999">999</a> / <a href="tel:112">112</a>. Childline Kenya: <a href="tel:116">116</a>. National GBV Hotline: <a href="tel:1195">1195</a>.</p>
        </div>
        <button type="button" className="footer-link" onClick={() => onNavigate("/library")}>
          View all resources
        </button>
      </footer>
    </main>
  );
}

export default LandingPage;
