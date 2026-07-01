/**
 * profileController.js
 * --------------------
 * Handles reading and updating the authenticated user's own profile.
 *
 * Each role has a different set of mutable fields:
 *   SURVIVOR       → displayNickname, assignedGender, residenceCounty, privacyPreferencesJson
 *   COUNSELLOR     → professionalSpecialization, availabilityStatus
 *   LEGAL_COUNSEL  → professionalSpecialization, availabilityStatus
 *   NGO_ADMIN      → administrativeDepartment
 *   MODERATOR      → (read-only via this controller — no mutable fields exposed)
 *
 * Immutable fields (userId, userRole, phoneNumber) are never updated here even
 * if included in the request body.
 *
 * All endpoints are scoped to the authenticated caller — cross-user reads and
 * writes are not possible through this controller.
 */

const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile
} = require('../models');

const { normalizeRole } = require('../utils/roles');

/**
 * Extracts the authenticated user's ID from the request's JWT claims.
 * The payload carries both 'userId' and 'id' for backward compatibility.
 *
 * @param {import('express').Request} req
 * @returns {string|null} The user's UUID, or null if no valid claim is present.
 */
function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

/**
 * Loads a UserAccount by ID and returns it with its normalized role string.
 * Returns null when the user does not exist or the ID is falsy.
 *
 * @param {string|null} userId - The UserAccount UUID from the JWT.
 * @returns {Promise<{ user: UserAccount, role: string }|null>}
 */
async function getActorWithRole(userId) {
  if (!userId) return null;

  const user = await UserAccount.findByPk(userId, {
    attributes: ['userId', 'phoneNumber', 'userRole', 'accountStatus', 'status', 'accountCreationTimestamp']
  });

  if (!user) return null;

  return {
    user,
    role: normalizeRole(user.userRole)
  };
}

/**
 * getProfile
 * ----------
 * GET /api/profile/me
 *
 * Returns the authenticated user's account and role-specific profile data.
 * For SURVIVOR callers, also includes the userId and phoneNumber of their
 * assigned counsellor and legal counsel (for display in the profile page).
 *
 * Response shape:
 *   {
 *     user:          { userId, phoneNumber, role, accountStatus, passwordResetRequired, createdAt },
 *     profile:       <role-specific profile row or null>,
 *     assignedStaff: { counsellor, legalCounsel } | null  (SURVIVOR only)
 *   }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function getProfile(req, res) {
  try {
    const actorUserId = getUserIdFromRequest(req);
    const actor = await getActorWithRole(actorUserId);

    if (!actor) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    let profile = null;
    let assignedStaff = null;

    if (actor.role === 'SURVIVOR') {
      profile = await SurvivorProfile.findOne({ where: { userId: actor.user.userId } });

      if (profile) {
        const [counsellorProfile, legalCounselProfile] = await Promise.all([
          profile.assignedCounsellorId
            ? CounsellorProfile.findByPk(profile.assignedCounsellorId, { attributes: ['counsellorId', 'userId'] })
            : null,
          profile.assignedLegalCounselId
            ? LegalCounselProfile.findByPk(profile.assignedLegalCounselId, { attributes: ['legalCounselId', 'userId'] })
            : null
        ]);

        const [counsellorUser, legalCounselUser] = await Promise.all([
          counsellorProfile?.userId
            ? UserAccount.findByPk(counsellorProfile.userId, { attributes: ['userId', 'phoneNumber'] })
            : null,
          legalCounselProfile?.userId
            ? UserAccount.findByPk(legalCounselProfile.userId, { attributes: ['userId', 'phoneNumber'] })
            : null
        ]);

        assignedStaff = {
          counsellor: counsellorUser
            ? { userId: counsellorUser.userId, phoneNumber: counsellorUser.phoneNumber }
            : null,
          legalCounsel: legalCounselUser
            ? { userId: legalCounselUser.userId, phoneNumber: legalCounselUser.phoneNumber }
            : null
        };
      }
    }

    if (actor.role === 'COUNSELLOR') {
      profile = await CounsellorProfile.findOne({ where: { userId: actor.user.userId } });
    }

    if (actor.role === 'LEGAL_COUNSEL') {
      profile = await LegalCounselProfile.findOne({ where: { userId: actor.user.userId } });
    }

    if (actor.role === 'NGO_ADMIN') {
      profile = await NgoAdministratorProfile.findOne({ where: { userId: actor.user.userId } });
    }

    return res.json({
      user: {
        userId: actor.user.userId,
        phoneNumber: actor.user.phoneNumber,
        role: actor.role,
        accountStatus: actor.user.accountStatus,
        passwordResetRequired: String(actor.user.status || '').toLowerCase() === 'password_reset_required',
        createdAt: actor.user.accountCreationTimestamp
      },
      profile: profile ? profile.toJSON() : null,
      assignedStaff
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to load profile.' });
  }
}

/**
 * updateProfile
 * -------------
 * PATCH /api/profile/me
 *
 * Updates the mutable fields of the authenticated user's role-specific profile.
 * Each role has a different allowed field set; fields outside that set are silently
 * ignored even if included in the request body.
 *
 * Validation is applied field-by-field: required strings are trimmed and
 * length-capped; ENUM fields are validated against allowed values before saving.
 *
 * Response:
 *   200 { message: string, profile: <updated profile row> }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function updateProfile(req, res) {
  try {
    const actorUserId = getUserIdFromRequest(req);
    const actor = await getActorWithRole(actorUserId);

    if (!actor) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (actor.role === 'SURVIVOR') {
      const profile = await SurvivorProfile.findOne({ where: { userId: actor.user.userId } });
      if (!profile) return res.status(404).json({ error: 'Survivor profile not found.' });

      const updates = {};

      if (req.body.displayNickname !== undefined) {
        const value = String(req.body.displayNickname || '').trim();
        if (!value) return res.status(400).json({ error: 'displayNickname cannot be empty.' });
        updates.displayNickname = value.slice(0, 50);
      }

      if (req.body.assignedGender !== undefined) {
        const value = String(req.body.assignedGender || '').trim().toUpperCase();
        updates.assignedGender = value || 'UNSPECIFIED';
      }

      if (req.body.residenceCounty !== undefined) {
        const value = String(req.body.residenceCounty || '').trim();
        if (!value) return res.status(400).json({ error: 'residenceCounty cannot be empty.' });
        updates.residenceCounty = value.slice(0, 50);
      }

      if (req.body.privacyPreferencesJson !== undefined) {
        updates.privacyPreferencesJson = req.body.privacyPreferencesJson || {};
      }

      await profile.update(updates);
      return res.json({ message: 'Profile updated successfully.', profile: profile.toJSON() });
    }

    if (actor.role === 'COUNSELLOR') {
      const profile = await CounsellorProfile.findOne({ where: { userId: actor.user.userId } });
      if (!profile) return res.status(404).json({ error: 'Counsellor profile not found.' });

      const updates = {};

      if (req.body.professionalSpecialization !== undefined) {
        const value = String(req.body.professionalSpecialization || '').trim();
        if (!value) return res.status(400).json({ error: 'professionalSpecialization cannot be empty.' });
        updates.professionalSpecialization = value.slice(0, 100);
      }

      if (req.body.availabilityStatus !== undefined) {
        const value = String(req.body.availabilityStatus || '').trim().toUpperCase();
        if (!['AVAILABLE', 'BUSY', 'OFFLINE'].includes(value)) {
          return res.status(400).json({ error: 'availabilityStatus must be AVAILABLE, BUSY, or OFFLINE.' });
        }
        updates.availabilityStatus = value;
      }

      await profile.update(updates);
      return res.json({ message: 'Profile updated successfully.', profile: profile.toJSON() });
    }

    if (actor.role === 'LEGAL_COUNSEL') {
      const profile = await LegalCounselProfile.findOne({ where: { userId: actor.user.userId } });
      if (!profile) return res.status(404).json({ error: 'Legal counsel profile not found.' });

      const updates = {};

      if (req.body.professionalSpecialization !== undefined) {
        const value = String(req.body.professionalSpecialization || '').trim();
        if (!value) return res.status(400).json({ error: 'professionalSpecialization cannot be empty.' });
        updates.professionalSpecialization = value.slice(0, 100);
      }

      if (req.body.availabilityStatus !== undefined) {
        const value = String(req.body.availabilityStatus || '').trim().toUpperCase();
        if (!['AVAILABLE', 'BUSY', 'OFFLINE'].includes(value)) {
          return res.status(400).json({ error: 'availabilityStatus must be AVAILABLE, BUSY, or OFFLINE.' });
        }
        updates.availabilityStatus = value;
      }

      await profile.update(updates);
      return res.json({ message: 'Profile updated successfully.', profile: profile.toJSON() });
    }

    if (actor.role === 'NGO_ADMIN') {
      const profile = await NgoAdministratorProfile.findOne({ where: { userId: actor.user.userId } });
      if (!profile) return res.status(404).json({ error: 'NGO admin profile not found.' });

      const updates = {};

      if (req.body.administrativeDepartment !== undefined) {
        const value = String(req.body.administrativeDepartment || '').trim();
        if (!value) return res.status(400).json({ error: 'administrativeDepartment cannot be empty.' });
        updates.administrativeDepartment = value.slice(0, 100);
      }

      await profile.update(updates);
      return res.json({ message: 'Profile updated successfully.', profile: profile.toJSON() });
    }

    return res.status(400).json({ error: 'Unsupported user role for profile updates.' });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
}

module.exports = {
  getProfile,
  updateProfile
};
