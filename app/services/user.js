const axios = require('axios');
const sequelize = require('sequelize');
const async = require('async');
const uuid = require('uuid');
const { Sequelize } = require('sequelize');

const { Op } = sequelize;

const SYNC_KEEPALIVE_INTERVAL_MS = 30 * 1000; // 30 seconds
const LAST_MAIL_RESEND_INTERVAL = 1000 * 60 * 10; // 10 minutes

module.exports = (Model, App) => {
  const log = App.logger;

  const RegisterNewUser = (user) => {
    // Check data
    if (!user.email || !user.password || !user.salt || !user.mnemonic) {
      throw new Error('Inssuficient registration data');
    }

    // Decrypt password
    const userPass = App.services.Crypt.decryptText(user.password);
    const userSalt = App.services.Crypt.decryptText(user.salt);

    const t = Model.users.sequelize.transaction();

    try {
      Model.users
        .findOne({ where: { email: { [Op.eq]: user.email } } })
        .then((result) => {
          console.log('Result', result);
        })
        .catch((err) => {
          console.log('Error', err);
        });
    } catch (e) {
      log.error(e);
    }
  };

  const FindOrCreate = (user) => {
    // Create password hashed pass only when a pass is given
    const userPass = user.password
      ? App.services.Crypt.decryptText(user.password)
      : null;
    const userSalt = user.salt
      ? App.services.Crypt.decryptText(user.salt)
      : null;

    // Throw error when user email. pass, salt or mnemonic is missing
    if (!user.email || !userPass || !userSalt || !user.mnemonic) {
      throw new Error('Wrong user registration data');
    }

    return Model.users.sequelize.transaction(async (t) => Model.users
      .findOrCreate({
        where: { email: user.email },
        defaults: {
          name: user.name,
          lastname: user.lastname,
          password: userPass,
          mnemonic: user.mnemonic,
          hKey: userSalt,
          referral: user.referral,
          uuid: uuid.v4(),
          referred: user.referred,
          credit: user.credit
        },
        transaction: t
      })
      .spread(async (userResult, created) => {
        if (created) {
          // Create bridge pass using email (because id is unconsistent)
          const bcryptId = await App.services.Storj.IdToBcrypt(
            userResult.email
          );

          const bridgeUser = await App.services.Storj.RegisterBridgeUser(
            userResult.email,
            bcryptId
          );

          if (
            bridgeUser
              && bridgeUser.response
              && bridgeUser.response.status === 500
          ) {
            throw Error(bridgeUser.response.data.error);
          }

          if (!bridgeUser.data) {
            throw new Error('Error creating bridge user');
          }

          log.info(
            'User Service | created brigde user: %s with uuid: %s',
            userResult.email,
            userResult.uuid
          );

          const freeTier = bridgeUser.data ? bridgeUser.data.isFreeTier : 1;
          // Store bcryptid on user register
          await userResult.update(
            { userId: bcryptId, isFreeTier: freeTier },
            { transaction: t }
          );

          // Set created flag for Frontend management
          Object.assign(userResult, { isCreated: created });
        }

        // TODO: proveriti userId kao pass
        return userResult;
      })
      .catch((err) => {
        if (err.response) {
          // This happens when email is registered in bridge
          log.error(err.response.data);
        } else {
          log.error(err.stack);
        }

        throw new Error(err);
      })); // end transaction
  };

  const InitializeUser = (user) => Model.users.sequelize.transaction((t) =>
    Model.users
      .findOne({ where: { email: { [Op.eq]: user.email } } })
      .then(async (userData) => {
        if (userData.root_folder_id) {
          userData.mnemonic = user.mnemonic;

          return userData;
        }

        const rootBucket = await App.services.Storj.CreateBucket(
          userData.email,
          userData.userId,
          user.mnemonic
        );
        log.info('User init | root bucket created %s', rootBucket.name);

        const rootFolderName = await App.services.Crypt.encryptName(
          `${rootBucket.name}`
        );

        const rootFolder = await userData.createFolder({
          name: rootFolderName,
          bucket: rootBucket.id
        });
        log.info('User init | root folder created, mysql id:', rootFolder.id);

        // Update user register with root folder Id
        await userData.update(
          { root_folder_id: rootFolder.id },
          { transaction: t }
        );

        // Set decrypted mnemonic to returning object
        const updatedUser = userData;
        updatedUser.mnemonic = user.mnemonic;
        updatedUser.root_folder_id = rootFolder.id;

        return updatedUser;
      })
      .catch((error) => {
        log.error(error.stack);
        throw new Error(error);
      }));

  // Get an email and option (true/false) and set storeMnemonic option for user with this email
  const UpdateStorageOption = (email, option) => Model.users
    .findOne({ where: { email: { [Op.eq]: email } } })
    .then((userData) => {
      if (userData) {
        return userData.update({ storeMnemonic: option });
      }

      throw new Error('UpdateStorageOption: User not found');
    })
    .catch((error) => {
      log.error(error.stack);
      throw new Error(error);
    });

  const GetUserById = (id) => Model.users.findOne({ where: { id: { [Op.eq]: id } } }).then((response) => response.dataValues);

  const FindUserByEmail = (email) => {
    console.log('email', email); // debug

    return new Promise((resolve, reject) => {
      Model.users
        .findOne({ where: { email: { [Op.eq]: email } } })
        .then((userData) => {
          if (userData) {
            const user = userData.dataValues;
            if (user.mnemonic) user.mnemonic = user.mnemonic.toString();

            resolve(user);
          } else {
            reject('User not found on X Cloud database');
          }
        })
        .catch((err) => reject(err));
    });
  };

  const FindUserByUuid = (uuid) => Model.users.findOne({ where: { uuid: { [Op.eq]: uuid } } });

  const FindUsersByReferred = (referredUuid) => new Promise((resolve, reject) => {
    Model.users
      .findAll({ where: { referred: { [Op.eq]: referredUuid } } })
      .then((response) => {
        resolve(response);
      })
      .catch((err) => reject(err));
  });

  const FindUserObjByEmail = (email) => {
     return Model.users.findOne({ where: { email: { [Op.eq]: email } } });
  }

  const GetUserCredit = (uuid) => Model.users
    .findOne({ where: { uuid: { [Op.eq]: uuid } } })
    .then((response) => response.dataValues);

  const GetUsersRootFolder = (id) => Model.users
    .findAll({
      include: [Model.folder]
    })
    .then((user) => user.dataValues);

  const UpdateMnemonic = async (userEmail, mnemonic) => {
    const found = FindUserByEmail(userEmail);
    if (found) {
      try {
        const user = await Model.users.update(
          { mnemonic },
          { where: { email: { [Op.eq]: userEmail } }, validate: true }
        );

        return user;
      } catch (errorResponse) {
        throw new Error(errorResponse);
      }
    } else {
      return null;
    }
  };

  const UpdateCredit = async (userUuid) => await Model.users.update(
    { credit: Sequelize.literal('credit + 5') },
    { where: { uuid: { [Op.eq]: userUuid } } }
  );

  const DecrementCredit = async (userUuid) => await Model.users.update(
    { credit: Sequelize.literal('credit - 5') },
    { where: { uuid: { [Op.eq]: userUuid } } }
  );

  const DeactivateUser = (email) => new Promise(async (resolve, reject) => {
    const shouldSend = await ShouldSendEmail(email);

    if (!shouldSend) {
      log.info('Do not resend deactivation email to %s', email);

      return resolve(); // noop
    }

    SetEmailSended(email);

    Model.users
      .findOne({ where: { email: { [Op.eq]: email } } })
      .then((user) => {
        const crypto = require('crypto-js');
        const password = crypto.SHA256(user.userId).toString();
        const auth = Buffer.from(`${user.email}:${password}`).toString(
          'base64'
        );

        axios
          .delete(`${App.config.get('STORJ_BRIDGE')}/users/${email}`, {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/json'
            }
          })
          .then((data) => {
            resolve(data);
          })
          .catch((err) => {
            log.warn(err.response.data);
            reject(err);
          });
      })
      .catch(reject);
  });

  const ConfirmDeactivateUser = (token) => new Promise((resolve, reject) => {
    async.waterfall(
      [
        (next) => {
          axios
            .get(
              `${App.config.get('STORJ_BRIDGE')}/deactivationStripe/${token}`,
              {
                headers: { 'Content-Type': 'application/json' }
              }
            )
            .then((res) => {
              console.log('User deleted from bridge');
              next(null, res);
            })
            .catch((err) => {
              console.log('Error user deleted from bridge');
              next(err);
            });
        },
        (data, next) => {
          const userEmail = data.data.email;
          Model.users
            .findOne({ where: { email: { [Op.eq]: userEmail } } })
            .then((user) => {
              console.log('User found on sql');

              const referralUuid = user.referral;
              if (uuid.validate(referralUuid)) {
                DecrementCredit(referralUuid);
                console.log('referral decremented');
              }

              user
                .destroy()
                .then((result) => {
                  console.log('User deleted on sql', userEmail);
                  next(null, data);
                })
                .catch((err) => {
                  console.log('Error deleting user on sql');
                  next(err);
                });
            })
            .catch(next);
        }
      ],
      (err, result) => {
        if (err) {
          console.log('Error waterfall', err);
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });

  const ResetPassword = (email) =>
    // TODO: Reset password should check ShouldSendEmail
    new Promise((resolve, reject) => {
      Model.user
        .findOne({ where: { email: { [Op.eq]: email } } })
        .then((user) => {
          const crypto = require('crypto-js');
          const password = crypto.SHA256(user.userId).toString();
          const auth = Buffer.from(`${user.email}:${password}`).toString(
            'base64'
          );

          axios
            .patch(`${App.config.get('STORJ_BRIDGE')}/users/${email}`, {
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json'
              }
            })
            .then(resolve)
            .catch((err) => {
              console.error(err.response.data);
              reject(err);
            });
        })
        .catch(reject);
    });
  const ConfirmResetPassword = (email, token, newPassword) => new Promise((resolve, reject) => {
    axios
      .post(`${App.config.get('STORJ_BRIDGE')}/resets/${token}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      })
      .then(resolve)
      .catch(reject);
  });

  const Store2FA = (user, key) => new Promise((resolve, reject) => {
    Model.users
      .update({ secret_2FA: key }, { where: { email: { [Op.eq]: user } } })
      .then(resolve)
      .catch(reject);
  });

  const Delete2FA = (user) => new Promise((resolve, reject) => {
    Model.users
      .update({ secret_2FA: null }, { where: { email: { [Op.eq]: user } } })
      .then(resolve)
      .catch(reject);
  });

  const UpdatePasswordMnemonic = (
    user,
    currentPassword,
    newPassword,
    newSalt,
    mnemonic
  ) => new Promise((resolve, reject) => {
    FindUserByEmail(user)
      .then((userData) => {
        console.log('Found on database');
        const storedPassword = userData.password.toString();
        if (storedPassword !== currentPassword) {
          console.log('Invalid password');
          reject({ error: 'Invalid password' });
        } else {
          console.log('Valid password');

          resolve();

          Model.users
            .update(
              {
                password: newPassword,
                mnemonic,
                hKey: newSalt
              },
              { where: { email: { [Op.eq]: user } } }
            )
            .then((res) => {
              console.log('Updated', res);
              resolve();
            })
            .catch((err) => {
              console.log('error updating', err);
              reject({ error: 'Error updating info' });
            });
        }
      })
      .catch((err) => {
        console.error(err);
        reject({ error: 'Internal server error' });
      });
  });

  const LoginFailed = (user, loginFailed) => new Promise((resolve, reject) => {
    Model.users
      .update(
        {
          errorLoginCount: loginFailed
            ? sequelize.literal('error_login_count + 1')
            : 0
        },
        { where: { email: user } }
      )
      .then((res) => resolve())
      .catch(reject);
  });

  const ShouldSendEmail = (email) => new Promise((resolve, reject) => {
    Model.users
      .findOne({ where: { email: { [Op.eq]: email } } })
      .then((user) => {
        if (!user.lastResend) {
          return resolve(true); // Field is null, send email
        }

        const dateDiff = new Date() - user.lastResend;
        resolve(dateDiff > LAST_MAIL_RESEND_INTERVAL);
      })
      .catch(reject);
  });

  const SetEmailSended = (email) => Model.users.update(
    {
      lastResend: new Date()
    },
    { where: { email: { [Op.eq]: email } } }
  );

  const ResendActivationEmail = (user) => new Promise(async (resolve, reject) => {
    const shouldSend = await ShouldSendEmail(user);
    if (shouldSend) {
      return resolve(); // noop
    }

    SetEmailSended(user);
    axios
      .post(`${process.env.STORJ_BRIDGE}/activations`, {
        email: user
      })
      .then((res) => resolve())
      .catch(reject);
  });

  const UpdateAccountActivity = (user) => new Promise((resolve, reject) => {
    Model.users
      .update({ updated_at: new Date() }, { where: { email: user } })
      .then((res) => {
        resolve();
      })
      .catch(reject);
  });

  const getSyncDate = () => {
    let syncDate = Date.now();
    syncDate += SYNC_KEEPALIVE_INTERVAL_MS;

    return new Date(syncDate);
  };

  const hasUserSyncEnded = (sync) => {
    if (!sync) {
      return true;
    }

    const now = Date.now();
    const syncTime = sync.getTime();

    return now - syncTime > SYNC_KEEPALIVE_INTERVAL_MS;
  };

  const GetUserSync = async (user, t) => {
    const opts = {
      where: { email: { [Op.eq]: user } },
      attributes: ['syncDate'],
      raw: true
    };

    if (t) {
      opts.lock = t.LOCK.UPDATE;
      opts.transaction = t;
    }

    const userSyncDate = await Model.users.findOne(opts);

    return userSyncDate.syncDate;
  };

  // TODO: Check transaction is actually running
  const UpdateUserSync = async (user, toNull, t) => {
    let sync = null;
    if (!toNull) {
      sync = getSyncDate();
    }

    const opts = { where: { email: user } };
    if (t) {
      opts.transaction = t;
    }

    await Model.users.update({ syncDate: sync }, opts);

    return sync;
  };

  const GetOrSetUserSync = async (user) => {
    const t = await Model.users.sequelize.transaction();
    const currentSync = await GetUserSync(user, t);
    const userSyncEnded = hasUserSyncEnded(currentSync);
    if (!currentSync || userSyncEnded) {
      await UpdateUserSync(user, false, t);
    }

    await t.commit();

    return !userSyncEnded;
  };

  const UnlockSync = async (user) => await Model.users.update(
    { syncDate: null },
    { where: { email: user.email } }
  );

  return {
    Name: 'User',
    FindOrCreate,
    UpdateMnemonic,
    UpdateStorageOption,
    GetUserById,
    FindUserByEmail,
    FindUserObjByEmail,
    FindUserByUuid,
    FindUsersByReferred,
    InitializeUser,
    GetUserCredit,
    GetUsersRootFolder,
    UpdateCredit,
    DecrementCredit,
    DeactivateUser,
    ConfirmDeactivateUser,
    Store2FA,
    Delete2FA,
    UpdatePasswordMnemonic,
    LoginFailed,
    ResendActivationEmail,
    UpdateAccountActivity,
    GetOrSetUserSync,
    UpdateUserSync,
    UnlockSync
  };
};
