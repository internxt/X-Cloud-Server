const sequelize = require('sequelize');

const { Op } = sequelize;

module.exports = (Model) => {
  const keysExists = async (user) => {
    if (!user) {
      return false;
    }
    const keys = await getKeys(user);
    return !!keys;
  }

  const getKeys = (user) => Model.keyserver.findOne({
    where: {
      user_id: { [Op.eq]: user.id }
    }
  });

  const addKeysLogin = (userData, publicKey, privateKey, revocationKey) => new Promise((resolve, reject) => {
    Model.keyserver.create({
      user_id: userData.id,
      public_key: publicKey,
      private_key: privateKey,
      revocation_key: revocationKey

    }).then((userKeys) => {
      resolve(userKeys);
    }).catch(() => {
      reject(Error('Error querying database'));
    });
  });

  return {
    Name: 'KeyServer',
    addKeysLogin,
    keysExists,
    getKeys

  };
};
