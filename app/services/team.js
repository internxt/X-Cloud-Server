const sequelize = require('sequelize');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const CryptService = require('./crypt');

const { Op } = sequelize;

module.exports = (Model, App) => {
  const CryptServiceInstance = CryptService(Model, App);

  const create = (team) => Model.teams.create({
    admin: team.admin,
    name: team.name,
    bridge_user: team.bridge_user,
    bridge_password: team.bridge_password,
    bridge_mnemonic: team.bridge_mnemonic
  }).then((newTeam) => newTeam.dataValues);

  const getTeamByEmail = (user) => Model.teams.findOne({ where: { admin: { [Op.eq]: user } } });

  const getTeamById = (idTeam) => Model.teams.findOne({ where: { id: { [Op.eq]: idTeam } } });

  const randomEmailBridgeUserTeam = () => {
    const rnd = crypto.randomBytes(8).toString('hex');
    const newEmail = `${rnd}-team@internxt.com`;
    const passwd = bcrypt.hashSync(newEmail, 8);

    return {
      bridge_user: newEmail,
      password: passwd
    };
  };

  const getIdTeamByUser = (user) => Model.teamsmembers.findOne({ where: { user: { [Op.eq]: user } } });

  const getTeamBridgeUser = (user) => Model.teams.findOne({
    where: { bridge_user: { [Op.eq]: user } }
  });

  const getPlans = async (user) => {
    const dataBridge = await getTeamBridgeUser(user);
    const pwd = dataBridge.bridge_password;
    const pwdHash = CryptServiceInstance.hashSha256(pwd);
    const credential = Buffer.from(`${dataBridge.bridge_user}:${pwdHash}`).toString('base64');
    const limit = await axios.get(`${App.config.get('STORJ_BRIDGE')}/limit`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credential}`
      }
    }).then((res) => res.data).catch(() => null);
    return limit;
  };

  const getTeamByMember = (email) => getIdTeamByUser(email).then((team) => (!team ? Promise.resolve() : getTeamById(team.id_team)));

  const ApplyLicenseTeams = async (user, size) => {
    const { GATEWAY_USER, GATEWAY_PASS } = process.env;

    return axios.post(`${process.env.STORJ_BRIDGE}/gateway/upgrade`, {
      email: user, bytes: size
    }, {
      headers: { 'Content-Type': 'application/json' },
      auth: { username: GATEWAY_USER, password: GATEWAY_PASS }
    });
  };

  return {
    Name: 'Team',
    create,
    getTeamByEmail,
    getTeamById,
    randomEmailBridgeUserTeam,
    getIdTeamByUser,
    getTeamByMember,
    getTeamBridgeUser,
    getPlans,
    ApplyLicenseTeams
  };
};
