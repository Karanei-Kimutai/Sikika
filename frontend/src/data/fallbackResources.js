/**
 * fallbackResources.js
 * ---------------------
 * Static fallback data shown in the public Library when the backend is
 * unreachable (network error or Cloudinary misconfiguration returning 503).
 *
 * These entries mirror the shape produced by the backend's API after category
 * formatting, so LibraryPage.jsx can render resource tiles without conditional
 * branching between live and fallback data.
 *
 * Fields per resource object:
 *   id          {string} — stable slug used as the React list key; matches the
 *                          backend resourceId UUID convention in spirit.
 *   title       {string} — display name shown in the tile heading.
 *   description {string} — one-sentence summary shown below the title.
 *   category    {string} — snake_case category matching SupportResource ENUM values
 *                          (emergency_hotlines | legal_guidance | shelters |
 *                           self_help | safety_planning).
 *   categoryLabel {string} — human-readable label shown as a chip/tag.
 *   fileUrl     {string} — placeholder URL; real delivery goes through the
 *                          backend proxy (GET /api/resources/:id/file) for live data.
 *   uploadedAt  {string} — ISO 8601 timestamp shown in the tile metadata row.
 */

/**
 * Five representative resources covering each supported category.
 * Rendered by LibraryPage.jsx as static tiles when the live API is unavailable.
 *
 * @type {Array<{
 *   id: string,
 *   title: string,
 *   description: string,
 *   category: string,
 *   categoryLabel: string,
 *   fileUrl: string,
 *   uploadedAt: string
 * }>}
 */
export const fallbackResources = [
  {
    id: "emergency-hotlines",
    title: "GBV Emergency Hotlines - Kenya",
    description: "A compiled list of 24/7 emergency hotlines for GBV survivors in Kenya.",
    category: "emergency_hotlines",
    categoryLabel: "Emergency Hotlines",
    fileUrl: "https://example.com/resources/emergency-hotlines.pdf",
    uploadedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "legal-rights",
    title: "Know Your Legal Rights",
    description: "A plain-language guide to legal rights for GBV survivors under Kenyan law.",
    category: "legal_guidance",
    categoryLabel: "Legal Guidance",
    fileUrl: "https://example.com/resources/legal-rights-guide.pdf",
    uploadedAt: "2026-01-02T00:00:00.000Z"
  },
  {
    id: "safe-houses-nairobi",
    title: "Safe Houses in Nairobi",
    description: "Directory of verified safe houses and shelters in the Nairobi region.",
    category: "shelters",
    categoryLabel: "Shelters",
    fileUrl: "https://example.com/resources/nairobi-shelters.pdf",
    uploadedAt: "2026-01-03T00:00:00.000Z"
  },
  {
    id: "trauma-recovery",
    title: "Healing After Trauma - Self-Help Guide",
    description: "Evidence-based self-help strategies for trauma recovery.",
    category: "self_help",
    categoryLabel: "Self Help",
    fileUrl: "https://example.com/resources/trauma-recovery.pdf",
    uploadedAt: "2026-01-04T00:00:00.000Z"
  },
  {
    id: "safety-plan",
    title: "Safety Planning Template",
    description: "A step-by-step personal safety plan template for survivors in active risk.",
    category: "safety_planning",
    categoryLabel: "Safety Planning",
    fileUrl: "https://example.com/resources/safety-plan-template.pdf",
    uploadedAt: "2026-01-05T00:00:00.000Z"
  }
];

/**
 * Corresponding category filter options, mirroring the live `/api/resources/categories`
 * response shape. Used to populate the Library's category filter when the API is down.
 *
 * @type {Array<{ value: string, label: string }>}
 */
export const fallbackCategories = [
  { value: "emergency_hotlines", label: "Emergency Hotlines" },
  { value: "legal_guidance", label: "Legal Guidance" },
  { value: "shelters", label: "Shelters" },
  { value: "self_help", label: "Self Help" },
  { value: "safety_planning", label: "Safety Planning" }
];
