const sequelize = require('sequelize');

const { Op } = sequelize;

module.exports = (Model) => {
  const removeMembers = (member) => Model.teamsmembers.destroy({ where: { user: { [Op.eq]: member } } });

  const getTeamsAdminById = (idTeam) => Model.teams.findOne({ where: { id: { [Op.eq]: idTeam } } });

  const getMembersByIdTeam = (idTeam) => Model.teamsmembers.findAll({ where: { id_team: { [Op.eq]: idTeam } } });

  const getInvitationsByIdTeam = (idTeam) => Model.teamsinvitations.findAll({ where: { id_team: { [Op.eq]: idTeam } } });

  const getPeople = async (idTeam) => {
    const result = [];
    const members = await getMembersByIdTeam(idTeam);
    const invitations = await getInvitationsByIdTeam(idTeam);
    members.forEach((m) => result.push({ isMember: true, isInvitation: false, user: m.user }));
    invitations.forEach((m) => result.push({ isMember: false, isInvitation: true, user: m.user }));
    return result;
  };

  const getMemberByIdTeam = (idTeam, email) => Model.teamsmembers.findOne({
    where: {
      id_team: { [Op.eq]: idTeam },
      user: { [Op.eq]: email }
    }
  });

  const addTeamMember = (idTeam, userEmail, bridgePassword, bridgeMnemonic) => Model.teamsmembers.findOne({
    where: {
      id_team: { [Op.eq]: idTeam },
      user: { [Op.eq]: userEmail }
    }
  }).then((teamMember) => (teamMember ? null : Model.teamsmembers.create({
    id_team: idTeam,
    user: userEmail,
    bridge_password: bridgePassword,
    bridge_mnemonic: bridgeMnemonic
  })));

  const saveMembersFromInvitations = (invitedMembers) => new Promise((resolve, reject) => {
    Model.teamsmembers.findOne({
      where: {
        user: { [Op.eq]: invitedMembers.user },
        id_team: { [Op.eq]: invitedMembers.id_team },
        bridge_password: { [Op.eq]: invitedMembers.bridge_password },
        bridge_mnemonic: { [Op.eq]: invitedMembers.bridge_mnemonic }
      }
    }).then((teamMember) => {
      if (teamMember) {
        reject();
      }
      Model.teamsmembers.create({
        id_team: invitedMembers.id_team,
        user: invitedMembers.user,
        bridge_password: invitedMembers.bridge_password,
        bridge_mnemonic: invitedMembers.bridge_mnemonic
      }).then((newMember) => {
        resolve(newMember);
      }).catch((err) => {
        reject(err);
      });
    }).catch((err) => {
      reject(err);
    });
  });

  return {
    Name: 'TeamsMembers',
    getMembersByIdTeam,
    addTeamMember,
    saveMembersFromInvitations,
    getMemberByIdTeam,
    getInvitationsByIdTeam,
    getPeople,
    removeMembers,
    getTeamsAdminById
  };
};
