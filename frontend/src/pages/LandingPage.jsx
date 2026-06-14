import { ArrowRight } from "lucide-react";
import heroArtwork from "../assets/hero.png";

/**
 * Public landing page for unregistered visitors.
 *
 * This page sets the product tone and routes users toward the two primary
 * actions agreed for this module: browsing resources and joining the community.
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

const steps = [
  "Browse public resources",
  "Join with a phone-based secure login",
  "Access support and community spaces"
];

function LandingPage({ onNavigate }) {
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Safe access to support</p>
          <h1>GBV Support Platform</h1>
          <p className="hero-text">
            We are building a discreet digital space where survivors and community members can find reliable
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
        </div>

        <div className="hero-visual" aria-hidden="true">
          <img src={heroArtwork} alt="" />
          <div className="support-panel">
            <span>24/7</span>
            <strong>Emergency contacts and safety planning resources</strong>
          </div>
        </div>
      </section>

      <section className="content-band" aria-labelledby="offer-heading">
        <div className="section-heading">
          <p className="eyebrow">What we offer</p>
          <h2 id="offer-heading">Support that is easy to find and careful with privacy</h2>
        </div>
        <div className="offer-grid">
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
        <ol className="steps-list">
          {steps.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
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
