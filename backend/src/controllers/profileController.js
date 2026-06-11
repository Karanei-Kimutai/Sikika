const {
  UserAccount,
  SurvivorProfile,
  CounsellorProfile,
  LegalCounselProfile,
  NgoAdministratorProfile,
  SystemAdministratorProfile
} = require('../models');

function getUserIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'LEGALCOUNSEL') return 'LEGAL_COUNSEL';
  if (role === 'NGOADMIN') return 'NGO_ADMIN';
  if (role === 'SYSTEMADMIN') return 'SYSTEM_ADMIN';
  return role;
}

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

    if (actor.role === 'SYSTEM_ADMIN') {
      profile = await SystemAdministratorProfile.findOne({ where: { userId: actor.user.userId } });
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

    if (actor.role === 'SYSTEM_ADMIN') {
      const profile = await SystemAdministratorProfile.findOne({ where: { userId: actor.user.userId } });
      if (!profile) return res.status(404).json({ error: 'System admin profile not found.' });

      const updates = {};

      if (req.body.maintenancePrivileges !== undefined) {
        const value = String(req.body.maintenancePrivileges || '').trim();
        if (!value) return res.status(400).json({ error: 'maintenancePrivileges cannot be empty.' });
        updates.maintenancePrivileges = value.slice(0, 255);
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
