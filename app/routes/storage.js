const fs = require('fs');

const rimraf = require('rimraf');
const contentDisposition = require('content-disposition');

const upload = require('../middleware/multer');
const passport = require('../middleware/passport');
const logger = require('../../lib/logger');

const Logger = logger.getInstance();

const { passportAuth } = passport;

module.exports = (Router, Service, App) => {
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
  Router.get('/storage/folder/:id/:idTeam?', passportAuth, (req, res) => {
    const folderId = req.params.id;
    const teamId = req.params.idTeam || null;

    Service.Folder.GetContent(folderId, req.user, teamId).then((result) => {
      if (result == null) {
        res.status(500).send([]);
      } else {
        res.status(200).json(result);
      }
    }).catch((err) => {
      Logger.error(`${err.message}\n${err.stack}`);
      res.status(500).json(err);
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
  Router.post('/storage/folder/:folderid/meta', passportAuth, (req, res) => {
    const { user } = req;
    const folderId = req.params.folderid;
    const { metadata } = req.body;

    Service.Folder.UpdateMetadata(user, folderId, metadata).then((result) => {
      res.status(200).json(result);
    }).catch((err) => {
      Logger.error(`Error updating metadata from folder ${folderId} : ${err}`);
      res.status(500).json(err.message);
    });
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
  Router.post('/storage/folder', passportAuth, (req, res) => {
    const { folderName, parentFolderId } = req.body;

    const { user } = req;
    user.mnemonic = req.headers['internxt-mnemonic'];

    Service.Folder.Create(user, folderName, parentFolderId).then((result) => {
      res.status(201).json(result);
    }).catch((err) => {
      Logger.warn(err);
      res.status(500).json({ error: err.message });
    });
  });

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
  Router.delete('/storage/folder/:id', passportAuth, (req, res) => {
    const { user } = req;
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const folderId = req.params.id;

    Service.Folder.Delete(user, folderId).then((result) => {
      res.status(204).json(result);
    }).catch((err) => {
      Logger.error(`${err.message}\n${err.stack}`);
      res.status(500).json(err);
    });
  });

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
  Router.post('/storage/folder/:id/upload', passportAuth, upload.single('xfile'), (req, res) => {
    const { user } = req;
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const xfile = req.file;
    const folderId = req.params.id;

    Service.Files.Upload(user, folderId, xfile.originalname, xfile.path)
      .then((result) => {
        res.status(201).json(result);
      })
      .catch((err) => {
        Logger.error(`${err.message}\n${err.stack}`);
        if (err.includes && err.includes('Bridge rate limit error')) {
          res.status(402).json({ message: err });
          return;
        }

        res.status(500).json({ message: err });
      });
  });

  /**
   * @swagger
   * /storage/moveFolder:
   *   post:
   *     description: Move folder on cloud DB from one folder to other
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: folderId
   *         description: folder id
   *         in: body
   *         required: true
   *       - name: destination
   *         description: destination folder
   *         in: body
   *         required: true
   *     responses:
   *       200:
   *         description: Folder moved successfully
   *       501:
   *         description: Folder with same name exists in folder destination.
   */
  Router.post('/storage/moveFolder', passportAuth, (req, res) => {
    const { folderId } = req.body;
    const { destination } = req.body;
    const { user } = req;

    Service.Folder.MoveFolder(user, folderId, destination).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      res.status(500).json(error);
    });
  });

  /**
   * @swagger
   * description: Create file entry on DB for an existing file on the network
   * Suitable for Desktop app.
   */
  Router.post('/storage/file', passportAuth, (req, res) => {
    const { user } = req;
    const { file } = req.body;

    Service.Files.CreateFile(user, file).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      Logger.error(error);
      res.status(400).json({ message: error.message });
    });
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
  Router.get('/storage/file/:id', passportAuth, (req, res) => {
    const { user } = req;
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const fileIdInBucket = req.params.id;
    if (fileIdInBucket === 'null') {
      return res.status(500).send({ message: 'Missing file id' });
    }

    return Service.Files.Download(user, fileIdInBucket).then(({
      filestream, mimetype, downloadFile, folderId, name, type, size
    }) => {
      const decryptedFileName = App.services.Crypt.decryptName(name, folderId);

      const fileNameDecrypted = `${decryptedFileName}${type ? `.${type}` : ''}`;
      const decryptedFileNameB64 = Buffer.from(fileNameDecrypted).toString('base64');

      res.setHeader('content-length', size);
      res.setHeader('content-disposition', contentDisposition(fileNameDecrypted));
      res.setHeader('content-type', mimetype);
      res.set('x-file-name', decryptedFileNameB64);
      filestream.pipe(res);
      fs.unlink(downloadFile, (error) => {
        if (error) throw error;
      });
    }).catch((err) => {
      if (err.message === 'Bridge rate limit error') {
        return res.status(402).json({ message: err.message });
      }
      return res.status(500).json({ message: err.message });
    });
  });

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
  Router.post('/storage/file/:fileid/meta', passportAuth, (req, res) => {
    const { user } = req;
    const fileId = req.params.fileid;
    const { metadata } = req.body;

    Service.Files.UpdateMetadata(user, fileId, metadata).then((result) => {
      res.status(200).json(result);
    }).catch((err) => {
      Logger.error(`Error updating metadata from file ${fileId} : ${err}`);
      res.status(500).json(err.message);
    });
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
  Router.post('/storage/moveFile', passportAuth, (req, res) => {
    const { fileId } = req.body;
    const { destination } = req.body;
    const { user } = req;

    Service.Files.MoveFile(user, fileId, destination).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      res.status(500).json(error);
    });
  });

  /*
   * Delete file by bridge (mongodb) ids
   */
  Router.delete('/storage/bucket/:bucketid/file/:fileid', passportAuth, (req, res) => {
    if (req.params.bucketid === 'null') {
      return res.status(500).json({ error: 'No bucket ID provided' });
    }

    if (req.params.fileid === 'null') {
      return res.status(500).json({ error: 'No file ID provided' });
    }

    const { user } = req;
    const bucketId = req.params.bucketid;
    const fileIdInBucket = req.params.fileid;

    return Service.Files.Delete(user, bucketId, fileIdInBucket).then(() => {
      res.status(200).json({ deleted: true });
    }).catch((err) => {
      Logger.error(err.stack);
      res.status(500).json({ error: err.message });
    });
  });

  /*
   * Delete file by database ids (mysql)
   */
  Router.delete('/storage/folder/:folderid/file/:fileid', passportAuth, (req, res) => {
    Service.Files.DeleteFile(req.user, req.params.folderid, req.params.fileid).then(() => {
      res.status(200).json({ deleted: true });
    }).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  });

  Router.post('/storage/share/file/:id', passportAuth, (req, res) => {
    const user = req.user.email;
    const itemId = req.params.id;
    const mnemonic = req.headers['internxt-mnemonic'];
    const { isFolder, views } = req.body;

    Service.Share.GenerateToken(user, itemId, mnemonic, isFolder, views).then((result) => {
      res.status(200).send({ token: result });
    }).catch((err) => {
      res.status(402).send(err.error ? err.error : { error: 'Internal Server Error' });
    });
  });

  Router.get('/storage/share/:token', (req, res) => {
    Service.Share.FindOne(req.params.token).then((result) => {
      Service.User.FindUserByEmail(result.user).then((userData) => {
        const fileIdInBucket = result.file;
        const isFolder = result.is_folder;

        userData.mnemonic = result.mnemonic;

        if (isFolder) {
          Service.Folder.GetTree({
            email: result.user
          }, result.file).then((tree) => {
            const maxAcceptableSize = 1024 * 1024 * 300; // 300MB
            const treeSize = Service.Folder.GetTreeSize(tree);

            if (treeSize <= maxAcceptableSize) {
              Service.Folder.Download(tree, userData).then(() => {
                const folderName = App.services.Crypt.decryptName(tree.name,
                  tree.parentId);

                Service.Folder.CreateZip(`./downloads/${tree.id}/${folderName}.zip`,
                  [`downloads/${tree.id}/${folderName}`]);

                res.set('x-file-name', `${folderName}.zip`);
                res.download(`./downloads/${tree.id}/${folderName}.zip`);

                rimraf(`./downloads/${tree.id}`);
              }).catch(() => {
                if (fs.existsSync(`./downloads/${tree.id}`)) {
                  rimraf(`./downloads/${tree.id}`);
                }

                res
                  .status(402)
                  .json({ error: 'Error downloading folder' });
              });
            } else {
              res.status(402).json({ error: 'Folder too large' });
            }
          }).catch(() => {
            res.status(402).json({ error: 'Error downloading folder' });
          });
        } else {
          Service.Files.Download(userData, fileIdInBucket).then(({
            filestream, mimetype, downloadFile, folderId, name, type
          }) => {
            const decryptedFileName = App.services.Crypt.decryptName(name, folderId);

            res.setHeader('Content-type', mimetype);

            const decryptedFileNameB64 = Buffer.from(`${decryptedFileName}${type ? `.${type}` : ''}`).toString('base64');
            const encodedFileName = encodeURI(`${decryptedFileName}${type ? `.${type}` : ''}`);

            res.setHeader('content-disposition', contentDisposition(encodedFileName));
            res.set('x-file-name', decryptedFileNameB64);

            filestream.pipe(res);
            fs.unlink(downloadFile, (error) => {
              if (error) throw error;
            });
          }).catch(({ message }) => {
            if (message === 'Bridge rate limit error') {
              res.status(402).json({ message });
              return;
            }
            res.status(500).json({ message });
          });
        }
      }).catch(() => {
        res.status(500).send({ error: 'User not found' });
      });
    }).catch(() => {
      res.status(500).send({ error: 'Invalid token' });
    });
  });
};
