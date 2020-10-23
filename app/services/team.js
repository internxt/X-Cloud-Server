const crypto = require('crypto');

const sequelize = require('sequelize');
const fetch = require('node-fetch');

const { Op } = sequelize;
const async = require('async');

module.exports = (Model, App) => {
  const FolderService = require('./folder')(Model, App);
  const UserService = require('./user')(Model, App);
  const StorjService = require('./storj')(Model, App);
  const CryptService = require('./crypt')(Model, App);

  const create = async (team) => {
    console.log('TEAM CREATION ----- ', team); // debug

    return await new Promise((resolve, reject) => {
      Model.teams
        .create({
          admin: team.admin,
          name: team.name,
          bridge_user: team.bridge_user,
          bridge_password: team.bridge_password,
          bridge_mnemonic: team.bridge_mnemonic
        })
        .then((newTeam) => {
          resolve(newTeam.dataValues);
        })
        .catch((err) => {
          reject({ error: 'Unable to create new team on db' });
        });
    });
  };

  const getTeamByIdUser = (user) => new Promise((resolve, reject) => {
    Model.teams
      .findOne({
        where: { admin: { [Op.eq]: user } }
      })
      .then((team) => {
        resolve(team);
      })
      .catch((err) => {
        console.error(err);
        reject('Error querying database');
      });
  });

  const getTeamById = (idTeam) => new Promise((resolve, reject) => {
    Model.teams
      .findOne({
        where: { id: { [Op.eq]: idTeam } }
      })
      .then((team) => {
        if (team) {
          resolve(team);
        } else {
          reject('Team does not exists');
        }
      })
      .catch((err) => {
        console.error(err);
        reject('Error querying database');
      });
  });

  const generateBridgeTeamUser = () => {
    const dateNow = new Date()
      .toISOString()
      .split('.')[0]
      .replace(/[-:T]/g, '');
    const passwd = CryptService.encryptText(dateNow, process.env.CRYPTO_KEY);

    return {
      email: `${dateNow}team@internxt.com`,
      password: passwd
    };
  };

  const getIdTeamByUser = (user) => new Promise((resolve, reject) => {
    Model.teams_members
      .findOne({
        where: {
          user: { [Op.eq]: user }
        }
      })
      .then((teamMember) => {
        console.log("TEAM MEMBER", teamMember); //debug
        resolve(teamMember);
      })
      .catch((err) => {
        console.error(err);
        reject('Error querying database');
      });
  });

  const getTeamByMember = function (userEmail) {
    return new Promise(function (resolve, reject) {
      getIdTeamByUser(userEmail).then(function (team) {
        if (!team) {
          return resolve()
        }
        getTeamById(team.id_team).then(function (team2) {
          console.log("FINDED TEAM", team2); //debug
          resolve(team2);
        }).catch((err) => { reject(); })
      }).catch((err) => { reject("TEAM NOT FOUND"); });
    });
  };

  getTeamByAdmin = (adminEmail) => {
    Model.teams.findOne({
      where: {
        admin: { [Op.eq]: adminEmail }
      }
    }).then((team) => {
      if (!team) {
        return reject("No team");
      } else {
        resolve(team);
      }
    }).catch((err) => { reject("Error querying database: ")})
  }

  const deleteTeam = (teamId) => new Promise((resolve, reject) => {
    Model.teams.destroy({
      where: {
        id: { [Op.eq]: teamId }
      }
    }).then((deletedTeam) => {
      if (deletedTeam === 1) {
        resolve();
      } else {
        reject();
      }
    }).catch((err) => { reject("Error deleting database"); })
  };

  const deleteAllTeamMembers = (teamId) => new Promise((resolve, reject) => {
    Model.teams_members.destroy({
      where: {
        team_id: { [Op.eq]: teamId }
      }
    }).then((deletedMembers) => {
      resolve();
    }).catch((err) => {
      reject("Error deleting database");
    })
  };

  const deleteTeamMember = (userEmail) => new Promise((resolve, reject) => {
    Model.teams_members.destroy({
      where: {
        user: { [Op.eq]: userEmail }
      }
    }).then((deletedMember) => {
      if (deletedMember === 1) {
        resolve();
      } else {
        reject();
      }
    }).catch ((err) => {
      reject("Error deleting database")
    })
  }

  return {
    Name: 'Team',
    create,
    getTeamByIdUser,
    getTeamById,
    generateBridgeTeamUser,
    getIdTeamByUser,
    getTeamByMember,
    getTeamByAdmin,
    deleteTeam,
    deleteAllTeamMembers,
    deleteTeamMember
  };
};
