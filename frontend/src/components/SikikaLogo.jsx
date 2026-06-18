/**
 * SikikaLogo
 * ----------
 * Inline SVG render of the Sikika brand icon mark: a teal rounded
 * speech-bubble/shield silhouette with an amber "voice" dot and three
 * concentric sound-wave strokes fanning out beneath it. Based on the
 * "Standalone" / "Icon Mark" variant from the Sikika brand handoff.
 *
 * Rendered inline (rather than referenced via <img>) so it can be reused at
 * any size — header brand mark, auth/landing hero, profile-avatar fallback —
 * without shipping a separate asset request per usage site, and so its fill
 * colors stay crisp at small sizes.
 *
 * @param {object} props
 * @param {number} [props.size=40] - Width/height in px; the icon's intrinsic
 *   aspect ratio (80:88) is preserved.
 * @param {string} [props.className] - Optional extra class name(s) for layout/spacing.
 * @param {boolean} [props.decorative=false] - Pass true when the icon sits next to
 *   visible text that already reads "Sikika" (brand mark, eyebrow, hero heading) —
 *   hides it from assistive tech so the name isn't announced twice. Leave false for
 *   standalone uses (e.g. the profile-avatar fallback) where the icon is the only label.
 * @returns {JSX.Element}
 */
function SikikaLogo({ size = 40, className = "", decorative = false }) {
  const height = Math.round((size * 88) / 80);

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 80 88"
      fill="none"
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Sikika"}
      aria-hidden={decorative ? "true" : undefined}
    >
      {/* Speech-bubble / shield silhouette — the brand's core teal shape */}
      <path
        d="M40,4 C58,4 74,12 74,24 L74,56 Q74,84 40,88 Q6,84 6,56 L6,24 C6,12 22,4 40,4 Z"
        fill="#0D5C63"
      />
      {/* Amber "voice" dot */}
      <circle cx="40" cy="37" r="4.5" fill="#E8A23B" />
      {/* Three sound-wave strokes, fading in opacity as they widen — evokes "being heard" */}
      <path d="M33,52 Q40,42 47,52" stroke="white" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path
        d="M27,60 Q40,44 53,60"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.75"
      />
      <path
        d="M21,68 Q40,46 59,68"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.45"
      />
    </svg>
  );
}

export default SikikaLogo;
