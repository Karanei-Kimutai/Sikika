import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import { User, Phone, ShieldCheck } from "lucide-react";
import { fadeInUp } from "../utils/motion";

/**
 * ManageProfilePage
 * -----------------
 * Authenticated profile view and edit form. The set of editable fields depends
 * on the user's role (SURVIVOR, COUNSELLOR/LEGAL_COUNSEL, or NGO_ADMIN), and
 * the form's payload is scoped accordingly before submission.
 *
 * The page also displays read-only account fields (userId, phone, role, status)
 * and, for SURVIVOR sessions, shows the phone numbers of their assigned staff.
 *
 * @returns {React.ReactElement}
 */
function ManageProfilePage() {
  /** Whether the profile data is being fetched on mount. */
  const [loading, setLoading] = useState(true);
  /** Whether a save request is in-flight. */
  const [saving, setSaving] = useState(false);
  /** Error message to display when fetch or save fails. */
  const [errorMessage, setErrorMessage] = useState("");
  /** Success message displayed after a successful profile update. */
  const [successMessage, setSuccessMessage] = useState("");
  /** Full API response from GET /api/profile/me (user + profile + assignedStaff). */
  const [profileData, setProfileData] = useState(null);
  /** Controlled form values for the editable fields for the current role. */
  const [formValues, setFormValues] = useState({});
  const shellRef = useRef(null);

  /** Uppercase role string memoized from the loaded profile data. */
  const role = useMemo(() => String(profileData?.user?.role || "").toUpperCase(), [profileData]);

  // Subtle entrance once the profile shell mounts.
  useEffect(() => {
    if (!shellRef.current) return;
    const mm = fadeInUp(shellRef.current, { y: 12 });
    return () => mm.revert();
  }, []);

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await apiClient.get(`/api/profile/me`);

        const data = response.data;
        setProfileData(data);

        const profile = data.profile || {};
        setFormValues({
          displayNickname: profile.displayNickname || "",
          assignedGender: profile.assignedGender || "UNSPECIFIED",
          residenceCounty: profile.residenceCounty || "",
          notificationsEnabled: Boolean(profile.privacyPreferencesJson?.notificationsEnabled),
          professionalSpecialization: profile.professionalSpecialization || "",
          availabilityStatus: profile.availabilityStatus || "AVAILABLE",
          administrativeDepartment: profile.administrativeDepartment || ""
        });
      } catch (error) {
        setErrorMessage(error.response?.data?.error || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  /**
   * Handles the profile form submission. Builds a role-scoped payload and
   * sends it to PATCH /api/profile/me. Fields outside the current role's
   * allowed set are intentionally omitted from the payload.
   *
   * @param {React.FormEvent<HTMLFormElement>} event
   * @returns {Promise<void>}
   */
  async function handleSaveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      let payload = {};

      if (role === "SURVIVOR") {
        payload = {
          displayNickname: formValues.displayNickname,
          assignedGender: formValues.assignedGender,
          residenceCounty: formValues.residenceCounty,
          privacyPreferencesJson: { notificationsEnabled: Boolean(formValues.notificationsEnabled) }
        };
      }

      if (role === "COUNSELLOR" || role === "LEGAL_COUNSEL") {
        payload = {
          professionalSpecialization: formValues.professionalSpecialization,
          availabilityStatus: formValues.availabilityStatus
        };
      }

      if (role === "NGO_ADMIN") {
        payload = {
          administrativeDepartment: formValues.administrativeDepartment
        };
      }

      await apiClient.patch(`/api/profile/me`, payload);

      setSuccessMessage("Profile updated successfully.");
    } catch (error) {
      setErrorMessage(error.response?.data?.error || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="profile-page">
        <section className="profile-shell">
          <p className="profile-empty">Loading your profile...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <section className="profile-shell" ref={shellRef}>
        <header className="profile-header">
          <h1>Manage Profile</h1>
          <p>Review and update the details relevant to your role.</p>
        </header>

        {errorMessage && <p className="status-message warning">{errorMessage}</p>}
        {successMessage && <p className="status-message">{successMessage}</p>}

        <article className="profile-summary-card">
          <p><User size={15} aria-hidden="true" /> <strong>User ID:</strong> {profileData?.user?.userId || "-"}</p>
          <p><Phone size={15} aria-hidden="true" /> <strong>Phone:</strong> {profileData?.user?.phoneNumber || "-"}</p>
          <p><ShieldCheck size={15} aria-hidden="true" /> <strong>Role:</strong> {profileData?.user?.role || "-"}</p>
          <p><ShieldCheck size={15} aria-hidden="true" /> <strong>Status:</strong> {profileData?.user?.accountStatus || "-"}</p>
        </article>

        <form className="profile-form" onSubmit={handleSaveProfile}>
          {role === "SURVIVOR" && (
            <>
              <label>
                Preferred Nickname
                <input
                  type="text"
                  value={formValues.displayNickname || ""}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, displayNickname: event.target.value }))}
                />
              </label>

              <label>
                Gender
                <select
                  value={formValues.assignedGender || "UNSPECIFIED"}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, assignedGender: event.target.value }))}
                >
                  <option value="UNSPECIFIED">Prefer not to say</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="NON_BINARY">Non-binary</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <label>
                County
                <input
                  type="text"
                  value={formValues.residenceCounty || ""}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, residenceCounty: event.target.value }))}
                />
              </label>

              <label className="profile-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(formValues.notificationsEnabled)}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, notificationsEnabled: event.target.checked }))}
                />
                <span>Enable Notifications</span>
              </label>
              <div className="profile-assigned-staff">
                <p><strong>Assigned Counsellor:</strong> {profileData?.assignedStaff?.counsellor?.phoneNumber || "Not assigned"}</p>
                <p><strong>Assigned Legal Counsel:</strong> {profileData?.assignedStaff?.legalCounsel?.phoneNumber || "Not assigned"}</p>
              </div>
            </>
          )}

          {(role === "COUNSELLOR" || role === "LEGAL_COUNSEL") && (
            <>
              <label>
                Professional Specialization
                <input
                  type="text"
                  value={formValues.professionalSpecialization || ""}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, professionalSpecialization: event.target.value }))}
                />
              </label>

              <label>
                Availability
                <select
                  value={formValues.availabilityStatus || "AVAILABLE"}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, availabilityStatus: event.target.value }))}
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="BUSY">Busy</option>
                  <option value="OFFLINE">Offline</option>
                </select>
              </label>
            </>
          )}

          {role === "NGO_ADMIN" && (
            <label>
              Administrative Department
              <input
                type="text"
                value={formValues.administrativeDepartment || ""}
                onChange={(event) => setFormValues((prev) => ({ ...prev, administrativeDepartment: event.target.value }))}
              />
            </label>
          )}

          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default ManageProfilePage;
