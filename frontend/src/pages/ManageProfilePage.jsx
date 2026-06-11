import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function getAuthHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function ManageProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [profileData, setProfileData] = useState(null);
  const [formValues, setFormValues] = useState({});

  const role = useMemo(() => String(profileData?.user?.role || "").toUpperCase(), [profileData]);

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await axios.get(`${API_BASE_URL}/api/profile/me`, {
          headers: getAuthHeaders()
        });

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
          administrativeDepartment: profile.administrativeDepartment || "",
          maintenancePrivileges: profile.maintenancePrivileges || ""
        });
      } catch (error) {
        setErrorMessage(error.response?.data?.error || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

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

      if (role === "SYSTEM_ADMIN") {
        payload = {
          maintenancePrivileges: formValues.maintenancePrivileges
        };
      }

      await axios.patch(`${API_BASE_URL}/api/profile/me`, payload, {
        headers: getAuthHeaders()
      });

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
      <section className="profile-shell">
        <header className="profile-header">
          <h1>Manage Profile</h1>
          <p>Review and update the details relevant to your role.</p>
        </header>

        {errorMessage && <p className="status-message warning">{errorMessage}</p>}
        {successMessage && <p className="status-message">{successMessage}</p>}

        <article className="profile-summary-card">
          <p><strong>User ID:</strong> {profileData?.user?.userId || "-"}</p>
          <p><strong>Phone:</strong> {profileData?.user?.phoneNumber || "-"}</p>
          <p><strong>Role:</strong> {profileData?.user?.role || "-"}</p>
          <p><strong>Status:</strong> {profileData?.user?.accountStatus || "-"}</p>
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
                Receive profile-related notifications
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

          {role === "SYSTEM_ADMIN" && (
            <label>
              Maintenance Privileges
              <input
                type="text"
                value={formValues.maintenancePrivileges || ""}
                onChange={(event) => setFormValues((prev) => ({ ...prev, maintenancePrivileges: event.target.value }))}
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
