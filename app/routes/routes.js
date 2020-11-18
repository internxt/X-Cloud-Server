const sgMail = require('@sendgrid/mail');
const speakeasy = require('speakeasy');
const useragent = require('useragent');
const uuid = require('uuid');

const ActivationRoutes = require('./activation');
const StorageRoutes = require('./storage');
const BridgeRoutes = require('./bridge');
const StripeRoutes = require('./stripe');
const DesktopRoutes = require('./desktop');
const MobileRoutes = require('./mobile');
const TwoFactorRoutes = require('./twofactor');

const passport = require('../middleware/passport');
const swaggerSpec = require('../../config/initializers/swagger');
const TeamsMembersRoutes = require('./teamsMembers');
const TeamsRoutes = require('./teams');
const team = require('./../services/team');
const crypto = require('crypto');
const AesUtil = require('../../lib/AesUtil');
const openpgp = require('openpgp');




const { passportAuth } = passport;
let isTeamActivated = false;
let userTeam = null;
let rootFolderId = 0;

module.exports = (Router, Service, Logger, App) => {
  // Documentation
  Router.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // User account activation/deactivation
  ActivationRoutes(Router, Service, Logger, App);
  // Files/folders operations
  StorageRoutes(Router, Service, Logger, App);
  // Calls to the BRIDGE api
  BridgeRoutes(Router, Service, Logger, App);
  // Calls to STRIPE api
  StripeRoutes(Router, Service, Logger, App);
  // Routes used by X-Cloud-Desktop
  DesktopRoutes(Router, Service, Logger, App);
  // Routes used by X-Cloud-Mobile
  MobileRoutes(Router, Service, Logger, App);
  // Routes to create, edit and delete the 2-factor-authentication
  TwoFactorRoutes(Router, Service, Logger, App);

  TeamsRoutes(Router, Service, Logger, App);
  TeamsMembersRoutes(Router, Service, Logger, App);


  /**
   * @swagger
   * /login:
   *   post:
   *     description: User login. Check if user exists.
   *     produces:
   *       - application/json
   *     parameters:
   *       - description: user object with email
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Email exists
   *       204:
   *         description: Wrong username or password
   */

  Router.post('/login', (req, res) => {
    req.body.email = req.body.email.toLowerCase();
    if (!req.body.email) {
      return res.status(400).send({ error: 'No email address specified' });
    }

    // Call user service to find user
    return Service.User.FindUserByEmail(req.body.email).then((userData) => {
      if (!userData) {
        // Wrong user

        return res.status(400).json({ error: 'Wrong email/password' });
      }

      return Service.Storj.IsUserActivated(req.body.email).then((resActivation) => {
        if (!resActivation.data.activated) {
          res.status(400).send({ error: 'User is not activated' });
        } else {
          const encSalt = App.services.Crypt.encryptText(
            userData.hKey.toString()
          );
          const required2FA = userData.secret_2FA && userData.secret_2FA.length > 0;
          Service.Keyserver.keysExists(userData).then((userKey) => {
            const publicKeyExists = true;
            const privateKeyExists = true;

            res.status(200).send({ publicKeyExists: publicKeyExists, privateKeyExists: privateKeyExists, sKey: encSalt, tfa: required2FA });
          }).catch((err) => {
            console.error(err);
            res.status(200).send({ sKey: encSalt, tfa: required2FA });
          })
        }
      }).catch((err) => {
        console.error(err);
        res.status(400).send({
          error: 'User not found on Bridge database',
          message: err.response ? err.response.data : err,
        });
      });
    }).catch((err) => {
      Logger.error(`${err}: ${req.body.email}`);
      res.status(400).send({
        error: 'User not found on Cloud database',
        message: err.message,
      });
    });
  });

  Router.post('/user/generateKey', (req, res) => {
    const email = req.body.email;
    const publicKey = req.body.publicKey;
    const privateKey = req.body.privateKey;
    const revocationKey = req.body.revocationKey;

    Service.User.FindUserByEmail(email).then((user) => {
      console.log(user)
      Service.Keyserver.addKeysLogin(user, publicKey, privateKey, revocationKey).then((userKey) => {

      }).catch((err) => {
        console.log('The keys could not be saved')
      });

    }).catch((err) => {
      console.log('The user is not in DB')

    });

  });


  /**
   * @swagger
   * /access:
   *   post:
   *     description: User login second part. Check if password is correct.
   *     produces:
   *       - application/json
   *     parameters:
   *       - description: user object with email and password
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Successfull login
   *       204:
   *         description: Wrong username or password
   */
  Router.post('/access', (req, res) => {
    const MAX_LOGIN_FAIL_ATTEMPTS = 3;

    let isTeamActivated = false;
    let rootFolderId = 0;
    let userTeam = null;


    // Call user service to find or create user
    Service.User.FindUserByEmail(req.body.email).then(async (userData) => {
      if (userData.errorLoginCount >= MAX_LOGIN_FAIL_ATTEMPTS) {
        res.status(500).send({
          error:
            'Your account has been blocked for security reasons. Please reach out to us'
        })
        return;
      }

      keys = await Service.Keyserver.keysExists(userData)


      let responseTeam = null;
      // Check if user has a team
      await new Promise((resolve, reject) => {
        Service.Team.getTeamByMember(req.body.email).then(async (team) => {
          userTeam = team;
          if (team !== undefined) {
            rootFolderId = (await Service.User.FindUserByEmail(team.bridge_user)).root_folder_id;
            responseTeam = await Service.Storj.IsUserActivated(team.bridge_user);
            if (responseTeam) {
              member = await Service.TeamsMembers.getMemberByIdTeam(team.id, req.body.email);
              if (member) {
                isTeamActivated = responseTeam.data.activated;
                userTeam = {
                  idTeam: team.id,
                  bridge_user: userTeam.bridge_user,
                  bridge_password: userTeam.bridge_password,
                  bridge_mnemonic: member.bridge_mnemonic,
                  admin: userTeam.admin,
                  root_folder_id: rootFolderId,
                  isActivated: isTeamActivated
                };
                resolve();
              }
            }
          }
          resolve();
        }).catch((error) => {
          Logger.error(error.stack);
          reject()
        });
      })


      // Process user data and answer API call
      const pass = App.services.Crypt.decryptText(req.body.password);

      // 2-Factor Auth. Verification
      const needsTfa = userData.secret_2FA && userData.secret_2FA.length > 0;
      let tfaResult = true;

      if (needsTfa) {
        tfaResult = speakeasy.totp.verifyDelta({
          secret: userData.secret_2FA,
          token: req.body.tfa,
          encoding: 'base32',
          window: 2
        });
      }

      if (!tfaResult) {
        res.status(400).send({ error: 'Wrong 2-factor auth code' });
      } else if (pass === userData.password.toString() && tfaResult) {
        // Successfull login
        const internxtClient = req.headers['internxt-client'];
        const token = passport.Sign(
          userData.email,
          App.config.get('secrets').JWT,
          internxtClient === 'x-cloud-web' || internxtClient === 'drive-web'
        );
        let teamRol = '';
        if (userTeam && userTeam.admin === req.body.email) {
          teamRol = 'admin';
        } else if (userTeam) {
          teamRol = 'member';
        }

        Service.User.LoginFailed(req.body.email, false);
        Service.User.UpdateAccountActivity(req.body.email);

        if (userTeam) {
          const tokenTeam = passport.Sign(userTeam.bridge_user, App.config.get('secrets').JWT,
            internxtClient === 'x-cloud-web' || internxtClient === 'drive-web')
          res.status(200).json({
            user: {
              userId: userData.userId,
              mnemonic: userData.mnemonic,
              root_folder_id: userData.root_folder_id,
              storeMnemonic: userData.storeMnemonic,
              name: userData.name,
              lastname: userData.lastname,
              uuid: userData.uuid,
              credit: userData.credit,
              publicKey: keys.public_key,
              privateKey: keys.private_key,
              revocationKey: keys.revocation_key
            },
            token,
            userTeam,
            teamRol,
            tokenTeam
          });
        } else {
          res.status(200).json({
            user: {
              userId: userData.userId,
              mnemonic: userData.mnemonic,
              root_folder_id: userData.root_folder_id,
              storeMnemonic: userData.storeMnemonic,
              name: userData.name,
              lastname: userData.lastname,
              uuid: userData.uuid,
              credit: userData.credit,
              publicKey: keys.public_key,
              privateKey: keys.private_key,
              revocationKey: keys.revocation_key
            },
            token,
            userTeam,
            teamRol,

          });
        }
      } else {
        // Wrong password
        if (pass !== userData.password.toString()) {
          Service.User.LoginFailed(req.body.email, true);
        }

        res.status(400).json({ error: 'Wrong email/password' });
      }

    }).catch((err) => {
      Logger.error(`${err.message}\n${err.stack}`);
      res.status(400).send({
        error: 'User not found on Cloud database',
        message: err.message
      });
    });
  });

  /**
   * @swagger
   * /register:
   *   post:
   *     description: User registration. User is registered or created.
   *     produces:
   *       - application/json
   *     parameters:
   *       - description: user object with all registration info
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Successfull user registration
   *       204:
   *         description: User with this email exists
   */
  Router.post('/register', async (req, res) => {
    // Data validation for process only request with all data
    if (req.body.email && req.body.password) {
      req.body.email = req.body.email.toLowerCase().trim();
      Logger.warn(
        'Register request for %s from %s',
        req.body.email,
        req.headers['X-Forwarded-For']
      );

      const newUser = req.body;
      newUser.credit = 0;

      const { referral } = req.body;

      if (uuid.validate(referral)) {
        await Service.User.FindUserByUuid(referral).then((userData) => {
          if (userData === null) {
            // Don't exists referral user
            console.log('No existe la uuid de referencia');
          } else {
            newUser.credit = 5;
            Service.User.UpdateCredit(referral);
          }
        }).catch((err) => console.log(err));
      }
      const { privateKey, publicKey, revocationKey } = req.body
      // Call user service to find or create user
      Service.User.FindOrCreate(newUser)
        .then((userData) => {
          console.log(userData)
          // Process user data and answer API call
          if (userData.isCreated) {
            const agent = useragent.parse(req.headers['user-agent']);
            const client = useragent.parse(req.headers['internxt-client']);
            if (client && client.source === '') {
              client.source = 'x-cloud-mobile';
            }

            Service.Statistics.Insert({
              name: client.source,
              user: userData.email,
              userAgent: agent.source,
              action: 'register'
            }).then(() => {
            }).catch((err) => {
              console.log('Error creating register statistics:', err);
            });

            // Successfull register
            const token = passport.Sign(
              userData.email,
              App.config.get('secrets').JWT
            );
            const user = { email: userData.email };
            res.status(200).send({ token, user });
          } else {
            // This account already exists
            res.status(400).send({ message: 'This account already exists' });
          }
        }).catch((err) => {
          Logger.error(`${err.message}\n${err.stack}`);
          res.status(500).send({ message: err.message });
        });
    } else {
      res.status(400).send({ message: 'You must provide registration data' });
    }
  });


  /**
   * @swagger
   * /initialize:
   *   post:
   *     description: User bridge initialization (creation of bucket and folder).
   *     produces:
   *       - application/json
   *     parameters:
   *       - description: user object with all info
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Successfull user initialization
   *       204:
   *         description: User needs to be activated
   */
  Router.post('/initialize', (req, res) => {
    // Call user service to find or create user
    Service.User.InitializeUser(req.body).then((userData) => {
      // Process user data and answer API call
      if (userData.root_folder_id) {
        // Successfull initialization
        const user = {
          email: userData.email,
          mnemonic: userData.mnemonic,
          root_folder_id: userData.root_folder_id
        };
        res.status(200).send({ user });
      } else {
        // User initialization unsuccessful
        res.status(400).send({ message: "Your account can't be initialized" });
      }
    }).catch((err) => {
      Logger.error(`${err.message}\n${err.stack}`);
      res.send(err.message);
    });
  });

  Router.put('/auth/mnemonic', passportAuth, (req, res) => {
    const {
      body: { email, mnemonic }
    } = req;
    Service.User.UpdateMnemonic(email, mnemonic)
      .then(() => {
        res.status(200).json({
          message: 'Successfully updated user with mnemonic'
        });
      }).catch(({ message }) => {
        Logger.error(message);
        res.status(400).json({ message, code: 400 });
      });
  });

  Router.patch('/user/password', passportAuth, (req, res) => {
    const user = req.user.email;

    const currentPassword = App.services.Crypt.decryptText(
      req.body.currentPassword
    );
    const newPassword = App.services.Crypt.decryptText(req.body.newPassword);
    const newSalt = App.services.Crypt.decryptText(req.body.newSalt);
    const { mnemonic } = req.body;

    Service.User.UpdatePasswordMnemonic(
      user,
      currentPassword,
      newPassword,
      newSalt,
      mnemonic
    ).then((result) => {
      res.status(200).send({});
    }).catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
  });

  Router.post('/user/claim', passportAuth, (req, res) => {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: 'hello@internxt.com',
      from: req.user.email,
      subject: 'New credit request',
      text:
        'Hello Internxt! I am ready to receive my credit for referring friends.'
    };
    sgMail.send(msg).then(() => {
      res.status(200).send({});
    }).catch((err) => {
      res.status(500).send(err);
    });
  });

  Router.post('/user/invite', passportAuth, (req, res) => {
    const { email } = req.body;

    Service.User.FindUserObjByEmail(email).then((user) => {
      if (user === null) {
        Service.Mail.sendInvitationMail(email, req.user).then(() => {
          Logger.info(
            'Usuario %s envia invitación a %s',
            req.user.email,
            req.body.email
          );
          res.status(200).send({});
        }).catch((err) => {
          Logger.error(
            'Error: Send mail from %s to %s',
            req.user.email,
            req.body.email
          );
          res.status(200).send({});
        });
      } else {
        Logger.warn(
          'Error: Send mail from %s to %s, already registered',
          req.user.email,
          req.body.email
        );
        res.status(200).send({});
      }
    }).catch((err) => {
      Logger.error(
        'Error: Send mail from %s to %s, SMTP error',
        req.user.email,
        req.body.email,
        err.message
      );
      res.status(200).send({});
    });
  });

  Router.get('/user/referred', passportAuth, (req, res) => {
    const { uuid } = req.user;

    Service.User.FindUsersByReferred(uuid).then((users) => res.status(200).send({
      total: users
    })).catch((message) => {
      Logger.error(message);
      res.status(500).send({ error: 'No users' });
    });
  });

  Router.get('/user/credit', passportAuth, (req, res) => {
    const { user } = req;

    return res.status(200).send({ userCredit: user.credit });
  });


  Router.get('/user/keys/:user', passportAuth, (req, res) => {
    const user = req.params.user
    Service.User.FindUserByEmail(user).then((userKeys) => {
      Service.Keyserver.keysExists(userKeys).then((keys) => {
        console.log('aqui si')
        res.status(200).send({ publicKey: keys.public_key })
      }).catch(async (err) => {
        const { privateKeyArmored, publicKeyArmored, revocationCertificate } = await openpgp.generateKey({
          userIds: [{ email: 'inxt@inxt.com' }],
          curve: 'ed25519',
        });
        const codpublicKey = Buffer.from(publicKeyArmored).toString('base64');
        Logger.error(message);
        res.status(200).send({ publicKey: codpublicKey });
        Logger.error('Error: The user not have keys')
        res.status(500).send({})
      })
    }).catch((err) => {
      Logger.error('Error: The user invited is not register')
      console.log(err)
      res.status(500).send({})
    })
  });

  Router.post('/team-invitations', passportAuth, function (req, res) {
    const email = req.body.email;
    const token = crypto.randomBytes(20).toString('hex');
    const Encryptbridge_password = req.body.bridgePass;
    const Encryptmnemonic = req.body.mnemonicTeam;
    console.log(req.body.email)
    console.log('req user',req.user)

    Service.User.FindUserByEmail(email).then((userData) => {
      Service.Keyserver.keysExists(userData).then(() => {
        Service.TeamInvitations.getTeamInvitationByIdUser(email).then((teamInvitation) => {
          if (teamInvitation) {
            Service.Mail.sendEmailTeamsMember(email, teamInvitation.token, req.team).then((team) => {
              Logger.info('The email is forwarded to the user %s', email)
              res.status(200).send({})
            }).catch((err) => {
              Logger.error('Error: Send invitation mail from %s to %s 1', req.user.email, email)
              res.status(500).send({ error: 'Error: Send invitation mail' })
            })
          }
        }).catch(err => {
          Logger.info('The user %s not have a team Invitation', email)
          Service.Team.getIdTeamByUser(email).then((responseMember) => {
            if (responseMember.status === 200) {
              res.status(200).send({});
            } else {
              res.status(400).send({ error: 'This user is alredy a member' });
            }
          }).catch((err) => {
            Logger.info('The user %s is not a member', email)
            Service.Team.getTeamBridgeUser(req.user.email).then(team => {
              Service.TeamInvitations.save({
                id_team: team.id,
                user: email,
                token: token,
                bridge_password: Encryptbridge_password,
                mnemonic: Encryptmnemonic
              }).then((user) => {
                Service.Mail.sendEmailTeamsMember(email, token, req.team).then((team) => {
                  Logger.info('User %s sends invitations to %s to join a team', req.user.email, req.body.email)
                  res.status(200).send({})
                }).catch((err) => {
                  Logger.error('Error: Send invitation mail from %s to %s 2', req.user.email, req.body.email)
                  res.status(500).send({})
                })
              }).catch((err) => {
                Logger.error('Error: Send invitation mail from %s to %s 3', req.user.email, req.body.email)
                console.log(err)
                res.status(500).send({})
              })
            }).catch(err => {
              Logger.error('The user %s not have a team Invitation', req.user.email)
              res.status(500).send({})
            })
          })
        })
      }).catch(err => {
        Logger.error('The user %s not have a public key', email)
        console.log(err)
        res.status(500).send({})
      })
    }).catch(err => {
      Logger.error('The user %s not have a team', req.user.email)
      res.status(500).send({})
    })
  });


  Router.post('/teams/join/:token', (req, res) => {
    const { token } = req.params;

    Service.TeamInvitations.getByToken(token).then((teamInvitation) => {
      Service.Team.getTeamById(teamInvitation.id_team).then((team) => {
        Service.User.FindUserByEmail(teamInvitation.user).then((userId) => {
          Service.Keyserver.keysExists(userId).then(async (userKey) => {
            Service.TeamsMembers.saveMembersFromInvitations({
              id_team: teamInvitation.id_team,
              user: teamInvitation.user,
              bridge_password: teamInvitation.bridge_password,
              bridge_mnemonic: teamInvitation.mnemonic
            }).then((newMember) => {
              Logger.info('Miembro %s save in teamsMembers', teamInvitation.user)
              teamInvitation.destroy().then(() => {
                res.status(200).send({})
              }).catch(err => {
                res.status(500).send({ error: 'The invitation could not be destroyed' })
              })
            }).catch((err) => {
              Logger.error('Error: User %s could not be saved in teamMember ', teamInvitation.user)
              res.status(500).send({ error: 'The invitation is not saved' })
            })
          }).catch((err) => {
            res.status(500).json({ error: 'Invalid Team invitation link' });
            Logger.error('Keys not exists')
          });
        }).catch((err) => {
          res.status(500).json({ error: 'Invalid Team invitation link' });
          Logger.error('User not exists')
        });

      }).catch((err) => {
        res.status(500).json({ error: 'Invalid Team invitation link' });
      });
    }).catch((err) => {
      res.status(500).json({ error: 'Invalid Team invitation link' });
      Logger.error('Token %s doesn\'t exists', token)
    });
  });
  return Router;
};
