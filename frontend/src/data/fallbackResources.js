/**
 * Development fallback data for the public library.
 *
 * These entries match the backend seeder shape after API formatting, allowing
 * the frontend to render useful tiles before the Express API or database is on.
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

export const fallbackCategories = [
  { value: "emergency_hotlines", label: "Emergency Hotlines" },
  { value: "legal_guidance", label: "Legal Guidance" },
  { value: "shelters", label: "Shelters" },
  { value: "self_help", label: "Self Help" },
  { value: "safety_planning", label: "Safety Planning" }
];
