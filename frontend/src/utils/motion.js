import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Shared motion system for the app.
 *
 * Every animation helper here is wrapped in `gsap.matchMedia()` against
 * `(prefers-reduced-motion: no-preference)`. Survivors may be using this
 * platform under stress, so anyone with OS-level reduced-motion enabled
 * gets the final visual state immediately with no animation at all —
 * never a "lighter" version of the animation.
 *
 * Durations/eases are intentionally short and subtle (calm, premium —
 * not bouncy or attention-grabbing) and centralised here so individual
 * components can't drift from that tone.
 */

export const EASE = "power2.out";
export const DURATION_SHORT = 0.32;
export const DURATION_MED = 0.48;

/**
 * Runs `animate` only when the user has not requested reduced motion.
 * When reduced motion is requested, `fallback` (default: a no-op that
 * just sets targets to their final visible state) runs instead.
 *
 * @param {Function} animate - receives nothing, runs gsap calls
 * @param {Function} [fallback]
 * @returns {gsap.MatchMedia} the matchMedia instance (call .revert() to clean up)
 */
function withMotionPreference(animate, fallback) {
  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", animate);
  if (fallback) {
    mm.add("(prefers-reduced-motion: reduce)", fallback);
  }
  return mm;
}

/**
 * Fades + slides elements up into view. Used for page-mount entrances
 * and single-element reveals (e.g. a freshly switched chat panel).
 *
 * @param {string|Element|NodeList|Array} targets
 * @param {object} [opts]
 * @param {number} [opts.y=14] - starting vertical offset in px
 * @param {number} [opts.duration=DURATION_MED]
 * @param {number} [opts.delay=0]
 * @returns {gsap.MatchMedia}
 */
export function fadeInUp(targets, opts = {}) {
  const { y = 14, duration = DURATION_MED, delay = 0 } = opts;
  return withMotionPreference(
    () => {
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration, delay, ease: EASE, clearProps: "transform" }
      );
    },
    () => {
      gsap.set(targets, { opacity: 1, y: 0 });
    }
  );
}

/**
 * Fades + slides a list of elements in with a small stagger, for
 * sidebar lists, card grids, and step lists.
 *
 * @param {string|Element|NodeList|Array} targets
 * @param {object} [opts]
 * @param {number} [opts.y=10]
 * @param {number} [opts.stagger=0.05]
 * @param {number} [opts.duration=DURATION_SHORT]
 * @returns {gsap.MatchMedia}
 */
export function staggerIn(targets, opts = {}) {
  const { y = 10, stagger = 0.05, duration = DURATION_SHORT } = opts;
  return withMotionPreference(
    () => {
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration, stagger, ease: EASE, clearProps: "transform" }
      );
    },
    () => {
      gsap.set(targets, { opacity: 1, y: 0 });
    }
  );
}

/**
 * Reveals an element (or staggered group) the first time it scrolls
 * into view. Intended for marketing/content sections, not chat UI.
 *
 * @param {string|Element|NodeList|Array} targets
 * @param {object} [opts]
 * @param {number} [opts.y=16]
 * @param {number} [opts.stagger=0.08]
 * @param {string} [opts.start="top 85%"] - ScrollTrigger start position
 * @returns {gsap.MatchMedia}
 */
export function revealOnScroll(targets, opts = {}) {
  const { y = 16, stagger = 0.08, start = "top 85%" } = opts;
  return withMotionPreference(
    () => {
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: DURATION_MED,
          stagger,
          ease: EASE,
          clearProps: "transform",
          scrollTrigger: {
            // `targets` may be a string selector, a single Element, or any
            // array-like collection (Array, NodeList, HTMLCollection) of
            // elements — ScrollTrigger needs a single element to watch, so
            // resolve collections down to their first member.
            trigger:
              typeof targets !== "string" && !(targets instanceof Element) && targets.length
                ? targets[0]
                : targets,
            start,
            once: true
          }
        }
      );
    },
    () => {
      gsap.set(targets, { opacity: 1, y: 0 });
    }
  );
}

/**
 * Animates a number counting up from 0 to `targetValue` by writing into
 * `element.textContent` on every tick. Used for dashboard KPI cards.
 *
 * @param {Element} element - target whose textContent gets overwritten each tick
 * @param {number} targetValue
 * @param {object} [opts]
 * @param {number} [opts.duration=0.7]
 * @param {Function} [opts.format] - formats the rounded value for display; default Math.round + toLocaleString
 * @returns {gsap.MatchMedia}
 */
export function countUp(element, targetValue, opts = {}) {
  const { duration = 0.7, format = (n) => Math.round(n).toLocaleString() } = opts;
  const target = Number(targetValue) || 0;
  return withMotionPreference(
    () => {
      const proxy = { value: 0 };
      gsap.to(proxy, {
        value: target,
        duration,
        ease: EASE,
        onUpdate: () => {
          element.textContent = format(proxy.value);
        }
      });
    },
    () => {
      element.textContent = format(target);
    }
  );
}

/**
 * A quick, calm scale-pulse for micro-interactions (e.g. send button on submit).
 * Always runs (even under reduced motion it's near-instant and non-directional),
 * but kept here for consistent easing/timing.
 *
 * @param {string|Element} target
 */
export function pulse(target) {
  gsap.fromTo(target, { scale: 1 }, { scale: 1.12, duration: 0.12, ease: "power1.out", yoyo: true, repeat: 1 });
}
