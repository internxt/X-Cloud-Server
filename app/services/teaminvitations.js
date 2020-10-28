const sequelize = require('sequelize');

const { Op } = sequelize;

module.exports = (Model, App) => {
  const save = (teamInvitation) => {
    return new Promise((resolve, reject) => {
      Model.team_invitations
        .create({
          id_team: teamInvitation.id_team,
          user: teamInvitation.user,
          token: teamInvitation.token,
        }).then((newTeamInvitation) => {
          resolve({teamInvitation: newTeamInvitation});
        }).catch((err) => {
          reject(err);
        });
    });
  };

  const remove = (user) => new Promise((resolve, reject) => {
    Model.team_invitations
      .destroy({
        where: {
          user: { [Op.eq]: user }
        }
      })
      .then(() => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });

  const createTableInvitationTeams = (teamInvitation) => {
    return new Promise((resolve, reject) => {
      Model.teaminvitations
        .create({
          id_team: teamInvitation.idTeam,
          user: teamInvitation.user,
          token: teamInvitation.token,
         
        }).then((newTeamInvitation) => {
          resolve({teamInvitation: newTeamInvitation});
        }).catch((err) => {
          reject(err);
        });
    });
  };

 

  const getByToken = (token) => {
    return new Promise((resolve, reject) => {
      Model.team_invitations
        .findOne({
          where: {
            token: { [Op.eq]: token },
          }
        })
        .then((teamInvitation) => {
          if (teamInvitation) {
            resolve(teamInvitation);
          } else {
            reject('Team invitation does not exists');
          }
        })
        .catch((err) => {
          reject('Error querying database');
        });
    });
  }
  
  const getTeamInvitationById = (idInvitation) => {
    return new Promise((resolve, reject) => {
      Model.team_invitations
        .findOne({
          where: { id: { [Op.eq]: idInvitation } },
        })
        .then((invitation) => {
          console.log('RESULTADO QUERY', invitation)
          if (invitation) {
            resolve(invitation);
          } else {
            reject('Team invitation does not exists');
          }
        })
        .catch((err) => {
          console.error(err);
          reject('Error querying database');
        });
    });
  }

  const getTeamInvitationByIdUser = (user) => {
    return new Promise((resolve, reject) => {
      Model.team_invitations
        .findOne({
          where: { user: { [Op.eq]: user } },
        })
        .then((teaminvitations) => {
          if (teaminvitations) {
            resolve(teaminvitations);
          } else {
            reject('Team invitation does not exists');
          }
        })
        .catch((err) => {
          console.error(err);
          reject('Error querying database');
        });
    });
  }

  return {
    Name: 'TeamInvitations',
    save,
    remove,
    createTableInvitationTeams,
    getByToken,
    getTeamInvitationById,
    getTeamInvitationByIdUser
  };
};
