const jwt = require('jsonwebtoken');
const passport = require('passport')
const fs = require('fs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode')
const upload = require('./../middleware/multer')
const swaggerSpec = require('./../../config/initializers/swagger')
const async = require('async')
const useragent = require('useragent')
const bip39 = require('bip39')

/**
 * JWT
 */
const passportAuth = passport.authenticate('jwt', {
  session: false
});

module.exports = (Router, Service, Logger, App) => {
  Router.get('/api-docs.json', function (req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
  })

  /**
   * @swagger
   * /login:
   *   post:
   *     description: User login first part. Check if user exists.
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

  Router.post('/login', function (req, res) {
    req.body.email = req.body.email.toLowerCase();
    if (!req.body.email) {
      return res.status(400).send({ error: 'No email address specified' });
    }
    // Call user service to find user
    Service.User.FindUserByEmail(req.body.email).then((userData) => {
      if (!userData) {
        // Wrong user
        res.status(400).json({ error: 'Wrong email/password' });
      } else {
        Service.Storj.IsUserActivated(req.body.email).then((resActivation) => {
          if (!resActivation.data.activated) {
            res.status(400).send({ error: 'User is not activated' });
          } else {
            const encSalt = App.services.Crypt.encryptText(userData.hKey.toString());
            const required_2FA = userData.secret_2FA != undefined && userData.secret_2FA.length > 0;
            res.status(200).send({ sKey: encSalt, tfa: required_2FA })
          }
        }).catch((err) => {
          res.status(400).send({ error: 'User not found on Bridge database', message: err.response ? err.response.data : err });
        });
      }
    }).catch((err) => {
      Logger.error(err + ': ' + req.body.email);
      res.status(400).send({ error: 'User not found on Cloud database', message: err.message });
    })
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

  Router.post('/access', function (req, res) {
    const MAX_LOGIN_FAIL_ATTEMPTS = 3;
    // Call user service to find or create user
    Service.User.FindUserByEmail(req.body.email).then((userData) => {
      if (userData.errorLoginCount >= MAX_LOGIN_FAIL_ATTEMPTS) {
        res.status(500).send({ error: 'Your account has been blocked for security reasons. Please reach out to us' });
        return;
      }
      // Process user data and answer API call
      const pass = App.services.Crypt.decryptText(req.body.password);


      // 2-Factor Auth. Verification
      const needsTfa = userData.secret_2FA != undefined && userData.secret_2FA.length > 0;
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
      } else if (pass == userData.password && tfaResult) {
        // Successfull login
        const token = jwt.sign(userData.email, App.config.get('secrets').JWT);

        const token2 = jwt.sign({
          email: userData.email,
          mnemonic: userData.mnemonic,
          root_folder_id: userData.root_folder_id
        }, App.config.get('secrets').JWT, {
          expiresIn: '14d'
        });

        Service.User.LoginFailed(req.body.email, false);

        // console.log(userData)
        res.status(200).json({
          user: {
            userId: userData.userId,
            mnemonic: userData.mnemonic,
            root_folder_id: userData.root_folder_id,
            storeMnemonic: userData.storeMnemonic,
            name: userData.name,
            lastname: userData.lastname
          },
          token
        });
      } else {
        // Wrong password
        if (pass !== userData.password) {
          Service.User.LoginFailed(req.body.email, true);
        }
        res.status(400).json({ error: 'Wrong email/password' });
      }
    }).catch((err) => {
      Logger.error(err.message + '\n' + err.stack);
      res.status(400).send({ error: 'User not found on Cloud database', message: err.message });
    });
  });

  /**
   * Gets a new 2FA code
   * Only auth. users can generate a new code.
   * Prevent 2FA users from getting a new code.
   */
  Router.get('/tfa', passportAuth, function (req, res) {
    const user = GetUserFromJwtToken(req.headers.authorization);
    Service.User.FindUserByEmail(user).then(async (userData) => {
      if (!userData) {
        res.status(500).send({ error: 'User does not exists' });
      } else if (userData.secret_2FA) {
        res.status(500).send({ error: 'User has already 2FA' });
      } else {
        const secret = speakeasy.generateSecret({ length: 10 });
        const url = speakeasy.otpauthURL({ secret: secret.ascii, label: 'Internxt' });
        const bidi = await qrcode.toDataURL(url);
        res.status(200).send({
          code: secret.base32,
          qr: bidi
        });
      }
    }).catch((err) => {
      res.status(500).send({ error: 'Server error' });
    });
  });

  Router.put('/tfa', passportAuth, function (req, res) {
    const user = GetUserFromJwtToken(req.headers.authorization);

    Service.User.FindUserByEmail(user).then((userData) => {
      if (userData.secret_2FA) {
        res.status(500).send({ error: 'User already has 2FA' });
      } else {
        // Check 2FA
        const isValid = speakeasy.totp.verifyDelta({
          secret: req.body.key,
          token: req.body.code,
          encoding: 'base32',
          window: 2
        });

        if (isValid) {
          Service.User.Store2FA(user, req.body.key)
            .then((result) => {
              res.status(200).send({ message: 'ok' });
            })
            .catch((err) => {
              res.status(500).send({ error: 'Error storing configuration' });
            })
        } else {
          res.status(500).send({ error: 'Code is not valid' });
        }
      }
    }).catch((err) => {
      res.status(500).send({ error: 'Internal server error' });
    });
  });

  Router.delete('/tfa', function (req, res) {
    const user = GetUserFromJwtToken(req.headers.authorization);

    Service.User.FindUserByEmail(user).then((userData) => {
      if (!userData.secret_2FA) {
        res.status(500).send({ error: 'Your account does not have 2FA activated.' });
      } else {
        // Check 2FA confirmation is valid
        const isValid = speakeasy.totp.verifyDelta({
          secret: userData.secret_2FA,
          token: req.body.code,
          encoding: 'base32',
          window: 2
        });

        // Check user password is valid
        const decryptedPass = App.services.Crypt.decryptText(req.body.pass);

        if (userData.password.toString() != decryptedPass) {
          res.status(500).send({ error: 'Invalid password' });
        } else if (!isValid) {
          res.status(500).send({ error: 'Invalid 2FA code. Please, use an updated code.' });
        } else {
          Service.User.Delete2FA(user).then((result) => {
            res.status(200).send({ message: 'ok' });
          }).catch((err) => {
            res.status(500).send({ error: 'Server error deactivating user 2FA. Try again later.' });
          });
        }
      }
    }).catch((err) => {
      res.status(500).send();
    })
  })

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
  Router.post('/register', function (req, res) {
    // Data validation for process only request with all data
    if (req.body.email && req.body.password) {
      req.body.email = req.body.email.toLowerCase().trim();
      // Call user service to find or create user
      Service.User.FindOrCreate(req.body).then((userData) => {
        // Process user data and answer API call
        if (userData.isCreated) {
          // Successfull register
          const token = jwt.sign(userData.email, App.config.get('secrets').JWT);
          const user = { email: userData.email }
          res.status(200).send({ token, user });
        } else {
          // This account already exists
          res.status(400).send({ message: 'This account already exists' });
        }
      }).catch((err) => {
        Logger.error(err.message + '\n' + err.stack);
        res.send(err.message);
      })
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
  Router.post('/initialize', function (req, res) {
    // Call user service to find or create user
    Service.User.InitializeUser(req.body)
      .then((userData) => {
        // Process user data and answer API call
        if (userData.root_folder_id) {
          // Successfull initialization
          const user = { email: userData.email, mnemonic: userData.mnemonic, root_folder_id: userData.root_folder_id }
          res.status(200).send({ user });
        } else {
          // User initialization unsuccessfull
          res.status(400).send({ message: "Your account can't be initialized" });
        }
      }).catch((err) => {
        Logger.error(err.message + '\n' + err.stack);
        res.send(err.message);
      })
  });

  Router.post('/plans', function (req, res) {
    const x = Service.Plan.ListAll().then((data) => {
      res.status(200).json(data);
    }).catch((e) => {
      res.status(400).json({ message: 'Error retrieving list of plans' });
    });
  });

  Router.post('/usage', function (req, res) {
    const axios = require('axios');
    const crypto = require('crypto')

    Service.User.FindUserByEmail(req.body.email)
      .then((userData) => {
        const pwd = userData.userId;
        const pwdHash = crypto.createHash('sha256').update(pwd).digest('hex');

        const credential = Buffer.from(userData.email + ':' + pwdHash).toString('base64');

        axios.get(App.config.get('STORJ_BRIDGE') + '/usage', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + credential
          }
        }).then((data) => {
          res.status(200).send(data.data);
        }).catch((err) => {
          res.status(400).send({ result: 'Error retrieving bridge information' });
        });
      }).catch((err) => {
        res.status(400).send({ result: 'Error retrieving user info' });
      });
  });

  Router.post('/limit', function (req, res) {
    const axios = require('axios');
    const crypto = require('crypto')

    Service.User.FindUserByEmail(req.body.email)
      .then((userData) => {
        const pwd = userData.userId;
        const pwdHash = crypto.createHash('sha256').update(pwd).digest('hex');

        const credential = Buffer.from(userData.email + ':' + pwdHash).toString('base64');

        axios.get(App.config.get('STORJ_BRIDGE') + '/limit', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + credential
          }
        }).then((data) => {
          res.status(200).send(data.data);
        }).catch((err) => {
          res.status(400).send({ result: 'Error retrieving bridge information' });
        });
      }).catch((err) => {
        res.status(400).send({ result: 'Error retrieving user info' });
      });
  });

  Router.put('/auth/mnemonic', function (req, res) {
    const {
      body: { email, mnemonic },
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
  })

  /**
   * @swagger
   * /user/:id:
   *   post:
   *     description: Get user.
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of user
   *         in: query
   *         required: true
   *     responses:
   *       200:
  */
  Router.get('/users/:id', passportAuth, function (req, res) {
    Service.User.GetUserById(req.params.id).then(function (foundUser) {
      res.send(foundUser);
    }).catch((err) => {
      Logger.error(err.message + '\n' + err.stack);
      res.status(500).json(err)
    });
  });

  /**
   * @swagger
   * /storage/folder/:id:
   *   post:
   *     description: Get folder contents.
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of folder in XCloud
   *         in: query
   *         required: true
   *     responses:
   *       200:
   *         description: Array of folder items
  */
  Router.get('/storage/folder/:id', passportAuth, function (req, res) {
    const folderId = req.params.id;
    Service.Folder.GetContent(folderId, req.user.dataValues.email)
      .then((result) => {
        res.status(200).json(result)
      }).catch((err) => {
        Logger.error(err.message + '\n' + err.stack);
        res.status(500).json(err)
      });
  });

  /**
   * @swagger
   * /storage/folder/:id/meta:
   *   post:
   *     description: Update metada on folder
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of folder in XCloud
   *         in: query
   *         required: true
   *       - name: metadata
   *         description: metadata to update (folderName, color, icon, ...)
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Folder updated
   *       500:
   *         description: Error updating folder
  */
  Router.post('/storage/folder/:id/meta', passportAuth, function (req, res) {
    const folderId = req.params.id;
    const metadata = req.body.metadata;

    Service.Folder.UpdateMetadata(folderId, metadata)
      .then((result) => {
        res.status(200).json(result);
      }).catch((error) => {
        Logger.error(`Error updating metadata from folder ${req.params.id} : ${error}`)
        res.status(500).json(error.message)
      })
  });

  /**
   * @swagger
   * /storage/folder:
   *   post:
   *     description: Create folder
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of folder in XCloud
   *         in: query
   *         required: true
   *     responses:
   *       200:
   *         description: Array of folder items
  */
  Router.post('/storage/folder', passportAuth, async function (req, res) {
    const folderName = req.body.folderName
    const parentFolderId = req.body.parentFolderId
    const user = req.user
    user.mnemonic = req.headers['internxt-mnemonic'];

    // console.log('Create folder %s, parent id: %s', folderName, parentFolderId)

    Service.Folder.Create(user, folderName, parentFolderId)
      .then((result) => {
        res.status(201).json(result)
      }).catch((err) => {
        Logger.warn(err);
        res.status(500).json({ error: err.message })
      });
  })

  /**
   * @swagger
   * /storage/folder/:id:
   *   post:
   *     description: Delete folder
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of folder in XCloud
   *         in: query
   *         required: true
   *     responses:
   *       200:
   *         description: Message
  */
  Router.delete('/storage/folder/:id', passportAuth, async function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const folderId = req.params.id
    // console.log('Delete folder: %s', folderId)

    Service.Folder.Delete(user, folderId)
      .then((result) => {
        res.status(204).json(result)
      }).catch((err) => {
        Logger.error(err.message + '\n' + err.stack);
        res.status(500).json(err)
      });
  })

  /**
   * @swagger
   * /storage/folder/:id/upload:
   *   post:
   *     description: Upload content to folder
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: ID of folder in XCloud
   *         in: query
   *         required: true
   *     responses:
   *       200:
   *         description: Uploaded object
  */
  Router.post('/storage/folder/:id/upload', passportAuth, upload.single('xfile'), async function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const xfile = req.file
    const folderId = req.params.id

    Service.Files.Upload(user, folderId, xfile.originalname, xfile.path)
      .then((result) => {
        res.status(201).json(result)
      }).catch((err) => {
        Logger.error(err.message + '\n' + err.stack);
        if (err.includes('Bridge rate limit error')) {
          res.status(402).json({ message: err })
          return;
        }
        res.status(500).json({ message: err })
      })
  })

  /**
   * @swagger
   * /storage/file:
   *   post:
   *     description: Create file on DB for local upload
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: file
   *         description: file object with properties
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: File created successfully
   *       400:
   *         description: Bad request. Any data is not passed on request.
   */
  Router.post('/storage/file', passportAuth, async function (req, res) {
    const file = req.body.file;
    Service.Files.CreateFile(file)
      .then((result) => {
        res.status(200).json(result);
      }).catch((error) => {
        res.status(400).json({ message: error.message });
      })
  })

  Router.get('/storage/tree', passportAuth, function (req, res) {
    const user = req.user;
    const agent = useragent.parse(req.headers['user-agent']);

    if (agent && agent.family === 'Electron') {
      Service.Statistics.Insert({
        name: 'X Cloud Desktop',
        user: user.email,
        userAgent: agent.source
      }).then(() => {

      }).catch(err => {
        console.log('Error creating statistics:', err)
      })
    }

    Service.Folder.GetTree(user).then(result => {
      res.status(200).send(result)
    }).catch(err => {
      res.status(500).send({ error: err.message })
    })
  });


  /**
   * @swagger
   * /storage/file/:id:
   *   post:
   *     description: Download file
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: fileId
   *         description: ID of file in XCloud
   *         in: query
   *         required: true
   *     responses:
   *       200:
   *         description: Uploaded object
  */
  Router.get('/storage/file/:id', passportAuth, async function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const fileIdInBucket = req.params.id
    if (fileIdInBucket === 'null') {
      return res.status(500).send({ message: 'Missing file id' })
    }
    let filePath;

    Service.Files.Download(user, fileIdInBucket)
      .then(({ filestream, mimetype, downloadFile, folderId }) => {
        filePath = downloadFile;
        const fileName = downloadFile.split('/')[2];
        const extSeparatorPos = fileName.lastIndexOf('.')
        const fileNameNoExt = fileName.slice(0, extSeparatorPos)
        const fileExt = fileName.slice(extSeparatorPos + 1);
        const decryptedFileName = App.services.Crypt.decryptName(fileNameNoExt, folderId);

        const decryptedFileName_b64 = Buffer.from(`${decryptedFileName}.${fileExt}`).toString('base64')

        res.setHeader('Content-type', mimetype);
        res.set('x-file-name', decryptedFileName_b64);
        filestream.pipe(res)
        fs.unlink(filePath, (error) => {
          if (error) throw error;
        });
      }).catch((err) => {
        if (err.message === 'Bridge rate limit error') {
          res.status(402).json({ message: err.message })
          return;
        }
        res.status(500).json({ message: err.message })
        console.log(err)
      })
  })

  /**
   * @swagger
   * /storage/file/:id/meta:
   *   post:
   *     description: Update metada on file
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: fileId
   *         description: ID of file in XCloud
   *         in: query
   *         required: true
   *       - name: metadata
   *         description: metadata to update (now is only name)
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: File updated
   *       500:
   *         description: Error updating file
  */
  Router.post('/storage/file/:id/meta', passportAuth, function (req, res) {
    const fileId = req.params.id;
    const metadata = req.body.metadata;

    Service.Files.UpdateMetadata(fileId, metadata)
      .then((result) => {
        res.status(200).json(result);
      }).catch((error) => {
        Logger.error(`Error updating metadata from file ${req.params.id} : ${error}`)
        res.status(500).json(error.message)
      })
  });

  /**
   * @swagger
   * /storage/moveFile:
   *   post:
   *     description: Move file on cloud DB from one folder to other
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: fileId
   *         description: file id
   *         in: body
   *         required: true
   *       - name: destination
   *         description: destination folder
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: File moved successfully
   *       501:
   *         description: File with same name exists in folder destination.
   */
  Router.post('/storage/moveFile', passportAuth, function (req, res) {
    const fileId = req.body.fileId;
    const destination = req.body.destination;
    const replace = req.body.overwritte === true;
    const user = req.user;

    Service.Files.MoveFile(user, fileId, destination, replace)
      .then(() => {
        res.status(200).json({ moved: true });
      }).catch((error) => {
        if (error.message && error.message.includes('same name')) {
          res.status(501).json({ message: error.message });
        }
      })
  })

  Router.get('/storage/file/:fileid/info', passportAuth, function (req, res) {
    const user = req.user;
    Service.Files.GetFileInfo(user, req.params.fileid).then(result => {
      console.log(result)
      res.status(200).send(result);
    }).catch(err => {
      res.status(500).send({ error: err.message });
    });
  })

  Router.delete('/storage/bucket/:bucketid/file/:fileid', passportAuth, function (req, res) {
    const user = req.user;
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const bucketId = req.params.bucketid
    const fileIdInBucket = req.params.fileid
    // console.log('Delete file: %s in %s', fileIdInBucket, bucketId)

    Service.Files.Delete(user, bucketId, fileIdInBucket)
      .then((result) => {
        res.status(200).json({ deleted: true })
      }).catch((err) => {
        Logger.error(err.stack);
        res.status(500).json({ error: err.message })
      })
  })

  Router.get('/user/isactivated', passportAuth, function (req, res) {
    const user = GetUserFromJwtToken(req.headers.authorization);
    Service.Storj.IsUserActivated(user).then((response) => {
      if (response.data) {
        res.status(200).send({ activated: response.data.activated })
      } else {
        res.status(400).send({ error: 'User activation info not found' })
      }
    }).catch((error) => {
      Logger.error(error.stack)
      res.status(500).json({ error: error.message })
    })
  })

  Router.post('/user/storeOption', passportAuth, function (req, res) {
    Service.User.UpdateStorageOption(req.body.email, req.body.option).then((response) => {
      res.status(200).json({ mnemonic: response.mnemonic })
    }).catch((error) => {
      res.status(500).json({ error: error.message })
    })
  })

  Router.get('/captcha/:token', function (req, res) {
    Service.User.resolveCaptcha(req.params.token)
      .then((response) => {
        res.status(200).json(response);
      }).catch((error) => {
        Logger.error(error.stack);
        res.status(500);
      })
  })

  Router.get('/storage/file/search', function (req, res) {
    // TODO
  });

  Router.get('/deactivate', passportAuth, function (req, res) {
    const user = GetUserFromJwtToken(req.headers.authorization);
    Service.User.DeactivateUser(user).then((bridgeRes) => {
      res.status(200).send({ error: null, message: 'User deactivated' });
    }).catch((err) => {
      res.status(500).send({ error: err.message });
    });
  });

  Router.get('/confirmDeactivation/:token', (req, res) => {
    const token = req.params.token;

    Service.User.ConfirmDeactivateUser(token).then((resConfirm) => {
      res.status(resConfirm.status).send(req.data);
    }).catch((err) => {
      console.log('Deactivation request to Server failed');
      console.log(err);
      res.status(400).send({ error: err.message });
    });
  });

  /**
   * Change X Cloud password.
   */
  Router.patch('/user/password', passportAuth, (req, res) => {
    const user = GetUserFromJwtToken(req.headers.authorization);

    const currentPassword = App.services.Crypt.decryptText(req.body.currentPassword);
    const newPassword = App.services.Crypt.decryptText(req.body.newPassword);
    const newSalt = App.services.Crypt.decryptText(req.body.newSalt);
    const mnemonic = req.body.mnemonic;

    console.log('Update Password and Mnemonic');

    Service.User.UpdatePasswordMnemonic(user, currentPassword, newPassword, newSalt, mnemonic)
      .then((result) => {
        console.log('Res OK');
        res.status(200).send({});
      }).catch((err) => {
        console.log('Res FAIL');
        console.log(err);
        res.status(500).send(err);
      });
  });

  Router.post('/storage/share/file/:id', passportAuth, (req, res) => {
    const user = GetUserFromJwtToken(req.headers.authorization);
    Service.Share.GenerateToken(user, req.params.id, req.headers['internxt-mnemonic'])
      .then((result) => {
        res.status(200).send(result);
      })
      .catch((err) => {
        console.log('Error:', err);
        res.status(404).send(err.error ? err.error : { error: 'Internal Server Error' });
      });
  });

  Router.get('/storage/share/:token', async (req, res) => {
    Service.Share.FindOne(req.params.token).then((result) => {
      Service.User.FindUserByEmail(result.user)
        .then((userData) => {
          const fileIdInBucket = result.file;
          userData.mnemonic = result.mnemonic;

          Service.Files.Download(userData, fileIdInBucket)
            .then(({ filestream, mimetype, downloadFile, folderId }) => {
              filePath = downloadFile;
              const fileName = downloadFile.split('/')[2];
              const extSeparatorPos = fileName.lastIndexOf('.')
              const fileNameNoExt = fileName.slice(0, extSeparatorPos)
              const fileExt = fileName.slice(extSeparatorPos + 1);
              const decryptedFileName = App.services.Crypt.decryptName(fileNameNoExt, folderId);

              res.setHeader('Content-type', mimetype);

              const decryptedFileName_b64 = Buffer.from(`${decryptedFileName}.${fileExt}`).toString('base64')
              const encodedFileName = encodeURI(`${decryptedFileName}.${fileExt}`)
              res.setHeader('Content-disposition', `attachment; filename*=UTF-8''${encodedFileName}; filename=${encodedFileName}`);

              res.set('x-file-name', decryptedFileName_b64);

              filestream.pipe(res)
              fs.unlink(filePath, (error) => {
                if (error) throw error;
              });
            }).catch(({ message }) => {
              if (message === 'Bridge rate limit error') {
                res.status(402).json({ message })
                return;
              }
              res.status(500).json({ message })
            })
        }).catch((err) => {
          console.error(err);
          res.status(500).send({ error: 'User not found' });
        });
    }).catch((err) => {
      console.error('Error', err);
      res.status(500).send({ error: 'Invalid token' });
    });
  });

  Router.get('/user/resend/:email', (req, res) => {
    Service.User.ResendActivationEmail(req.params.email).then((result) => {
      console.log(result);
      res.status(200).send({ message: 'ok' });
    }).catch((err) => {
      res.status(500).send({ error: err.response.data && err.response.data.error ? err.response.data.error : 'Internal server error' });
    });
  })

  /**
   * Should create a new Stripe Session token.
   * Stripe Session is neccesary to perform a new payment
   */
  Router.post('/stripe/session', passportAuth, (req, res) => {
    const planToSubscribe = req.body.plan;

    let stripe = require('stripe')(process.env.STRIPE_SK);

    if (req.body.test) {
      stripe = require('stripe')(process.env.STRIPE_SK_TEST);
    }
    
    const user = GetUserFromJwtToken(req.headers.authorization);

    async.waterfall([
      (next) => {
        // Retrieve the customer by email, to check if already exists
        stripe.customers.list({
          limit: 1, email: user
        }, (err, customers) => {
          next(err, customers.data[0]);
        });
      },
      (customer, next) => {
        if (!customer) {
          // The customer does not exists
          // Procede to the subscription
          console.debug('Customer does not exists, won\'t check any subcription');
          next(null, undefined);
        } else {
          // Get subscriptions
          const subscriptions = customer.subscriptions.data;
          if (subscriptions.length === 0) {
            console.log('Customer exists, but doesn\'t have a subscription');
            next(null, { customer, subscription: null });
          } else {
            console.log('Customer already has a subscription');
            const subscription = subscriptions[0];
            next(null, { customer, subscription });
          }
        }
      },
      (payload, next) => {
        if (!payload) {
          console.debug('Customer does not exists');
          next(null, {});
        } else {
          const { customer, subscription } = payload;
          console.debug('Payload', subscription);

          if (subscription) {
            // Delete subscription (must be improved in the future)
            /*
            stripe.subscriptions.del(subscription.id, (err, result) => {
              next(err, customer);
            });
            */
            next(Error('Already subscribed'));
          } else {
            next(null, customer);
          }
        }
      },
      (customer, next) => {
        // Open session
        const customer_id = customer !== null ? customer.id || null : null;

        const session_params = {
          payment_method_types: ['card'],
          success_url: 'https://cloud.internxt.com/',
          cancel_url: 'https://cloud.internxt.com/',
          subscription_data: {
            items: [{ plan: req.body.plan }],
            trial_period_days: 30
          },
          customer_email: user,
          customer: customer_id,
          billing_address_collection: 'required'
        };

        if (session_params.customer) {
          delete session_params.customer_email;
        } else {
          delete session_params.customer;
        }

        stripe.checkout.sessions.create(session_params).then(result => {
          next(null, result);
        }).catch(err => { next(err); });

      }
    ], (err, result) => {
      console.log(result);
      if (err) {
        console.log('Error', err.message);
        res.status(500).send({ error: err.message });
      } else {
        console.log('Correcto', result);
        res.status(200).send(result);
      }
    })
  });

  /**
   * Retrieve products listed in STRIPE.
   * Products must be inserted on stripe using the dashboard with the required metadata.
   * Required metadata: 
   */
  Router.get('/stripe/products', (req, res) => {
    const stripe = require('stripe')(req.query.test ? process.env.STRIPE_SK_TEST : process.env.STRIPE_SK);
    stripe.products.list({}, (err, products) => {
      if (err) {
        res.status(500).send({ error: err });
      } else {
        const productsMin = products.data.filter(p => !(!p.metadata.size_bytes)).map(p => {
          return { id: p.id, name: p.name, metadata: p.metadata };
        }).sort((a, b) => a.metadata.price_eur * 1 - b.metadata.price_eur * 1);
        res.status(200).send(productsMin);
      }
    });
  });

  /**
   * Get available plans from a given product.
   */
  Router.post('/stripe/plans', (req, res) => {
    const stripe = require('stripe')(req.body.test ? process.env.STRIPE_SK_TEST : process.env.STRIPE_SK);
    const stripeProduct = req.body.product;

    stripe.plans.list({
      product: stripeProduct
    }, (err, plans) => {
      if (err) {
        res.status(500).send({ error: err.message });
      } else {
        const plansMin = plans.data.map(p => {
          return {
            id: p.id,
            price: p.amount,
            name: p.nickname,
            interval: p.interval,
            interval_count: p.interval_count
          }
        }).sort((a, b) => a.price * 1 - b.price * 1);
        res.status(200).send(plansMin);
      }
    });

  });

  Router.get('/bits', (req, res) => {
    const newBits = bip39.generateMnemonic(256)
    const eNewBits = App.services.Crypt.encryptText(newBits)
    res.status(200).send({ bits: eNewBits })
  })

  function GetUserFromJwtToken(token) {
    return jwt.decode(token.split(' ')[1], App.config.get('secrets').JWT);
  }

  return Router;
}
