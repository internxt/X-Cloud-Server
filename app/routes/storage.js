const fs = require('fs');
const upload = require('../middleware/multer')

const passport = require('../middleware/passport')
const passportAuth = passport.passportAuth
var rimraf = require("rimraf");


module.exports = (Router, Service, Logger, App) => {

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
    Service.Folder.GetContent(folderId, req.user)
      .then((result) => {
        if (result == null) {
          res.status(500).send([])
        } else {
          res.status(200).json(result)
        }
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
  Router.post('/storage/folder/:folderid/meta', passportAuth, function (req, res) {
    const user = req.user
    const folderId = req.params.folderid;
    const metadata = req.body.metadata;

    Service.Folder.UpdateMetadata(user, folderId, metadata)
      .then((result) => {
        res.status(200).json(result);
      }).catch((err) => {
        Logger.error(`Error updating metadata from folder ${folderId} : ${err}`)
        res.status(500).json(err.message)
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
  Router.post('/storage/folder', passportAuth, function (req, res) {
    const folderName = req.body.folderName
    const parentFolderId = req.body.parentFolderId

    const user = req.user
    user.mnemonic = req.headers['internxt-mnemonic'];

    Service.Folder.Create(user, folderName, parentFolderId).then((result) => {
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
  Router.delete('/storage/folder/:id', passportAuth, function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const folderId = req.params.id

    Service.Folder.Delete(user, folderId).then((result) => {
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
  Router.post('/storage/folder/:id/upload', passportAuth, upload.single('xfile'), function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const xfile = req.file
    const folderId = req.params.id

    Service.Files.Upload(user, folderId, xfile.originalname, xfile.path).then((result) => {
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
  Router.post('/storage/moveFolder', passportAuth, function (req, res) {
    const folderId = req.body.folderId;
    const destination = req.body.destination;
    const combine = req.body.combine === true;
    const replaceAll = req.body.replaceAll === true;
    const combineAll = req.body.combineAll === true;
    const path = req.body.destinationPath;
    const user = req.user;
    const mainFolder = req.body.mainFolder;
    
    Service.Folder.MoveFolder(user, folderId, destination, mainFolder, combine, replaceAll, combineAll, false, path).then((result) => {
      res.status(200).json({ moved: true, removedFolders: result.removedFolders, item: result.item, destination: result.destination });
    }).catch((error) => {
      if (error.error && error.error.message && error.error.message.includes('same name')) {
        res.status(501).json(error);
      } else {
        res.status(500).json(error);
      }
    })
  })

  /**
   * @swagger
   * /storage/file:
   *   post:
   *     description: Create file entry on DB for an existing bucketentry
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
  Router.post('/storage/file', passportAuth, function (req, res) {
    const user = req.user
    const file = req.body.file;
    Service.Files.CreateFile(user, file).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      Logger.error(error)
      res.status(400).json({ message: error.message });
    })
  })

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
  Router.get('/storage/file/:id', passportAuth, function (req, res) {
    const user = req.user
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const fileIdInBucket = req.params.id
    if (fileIdInBucket === 'null') {
      return res.status(500).send({ message: 'Missing file id' })
    }
    let filePath;

    Service.Files.Download(user, fileIdInBucket).then(({ filestream, mimetype, downloadFile, folderId }) => {
      filePath = downloadFile;
      const fileName = downloadFile.split('/')[2];
      const extSeparatorPos = fileName.lastIndexOf('.')
      const fileNameNoExt = fileName.slice(0, extSeparatorPos)
      const fileExt = fileName.slice(extSeparatorPos + 1);
      const decryptedFileName = App.services.Crypt.decryptName(fileNameNoExt, folderId);

      const decryptedFileNameB64 = Buffer.from(`${decryptedFileName}.${fileExt}`).toString('base64')

      res.setHeader('Content-type', mimetype);
      res.set('x-file-name', decryptedFileNameB64);
      filestream.pipe(res)
      fs.unlink(filePath, (error) => {
        if (error) throw error;
      });
    }).catch((err) => {
      if (err.message === 'Bridge rate limit error') {
        return res.status(402).json({ message: err.message })
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
  Router.post('/storage/file/:fileid/meta', passportAuth, function (req, res) {
    const user = req.user
    const fileId = req.params.fileid;
    const metadata = req.body.metadata;

    Service.Files.UpdateMetadata(user, fileId, metadata).then((result) => {
      res.status(200).json(result);
    }).catch((err) => {
      Logger.error(`Error updating metadata from file ${fileId} : ${err}`)
      res.status(500).json(err.message)
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
    const path = req.body.destinationPath;
    const mainFolder = req.body.mainFolder;

    Service.Files.MoveFile(user, fileId, destination, mainFolder, replace, false, path).then((result) => {
      res.status(200).json({ moved: true, removedFolders: result.removedFolders, item: result.item, destination: result.destination });
    }).catch((error) => {
      if (error.error.message && error.error.message.includes('same name')) {
        res.status(501).json(error);
      } else {
        res.status(500).json(error);
      }
    })
  })

  /*
   * Delete file by bridge (mongodb) ids
   */
  Router.delete('/storage/bucket/:bucketid/file/:fileid', passportAuth, function (req, res) {
    if (req.params.bucketid === 'null') {
      return res.status(500).json({ error: 'No bucket ID provided' })
    }

    if (req.params.fileid === 'null') {
      return res.status(500).json({ error: 'No file ID provided' })
    }

    const user = req.user;
    const bucketId = req.params.bucketid
    const fileIdInBucket = req.params.fileid

    Service.Files.Delete(user, bucketId, fileIdInBucket).then(() => {
      res.status(200).json({ deleted: true })
    }).catch((err) => {
      Logger.error(err.stack);
      res.status(500).json({ error: err.message })
    })
  })

  /*
   * Delete file by database ids (mysql)
   */
  Router.delete('/storage/folder/:folderid/file/:fileid', passportAuth, (req, res) => {
    Service.Files.DeleteFile(req.user, req.params.folderid, req.params.fileid).then(() => {
      res.status(200).json({ deleted: true })
    }).catch((err) => {
      console.error('Error deleting file:', err.message)
      res.status(500).json({ error: err.message })
    })
  })

  Router.post('/storage/shortLink', passportAuth, (req, res) => {
    const user = req.user.email;
    const url  = req.body.url;

    Service.Share.GenerateShortLink(user, url).then((shortLink) => {
      res.status(200).json(shortLink)
    }).catch((err) => {
      res.status(500).json({ error: err.message })
    });
  });

  Router.post('/storage/share/file/:id', passportAuth, (req, res) => {
    const user = req.user.email

    Service.Share.GenerateToken(
      user,
      req.params.id,
      req.headers['internxt-mnemonic'],
      req.body.isFolder,
      req.body.views
    ).then((result) => {
      res.status(200).send(result);
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
          Service.Folder.GetTree({email: result.user}, result.file).then((tree) => {
            const maxAcceptableSize = 209715200; // 200MB
            const treeSize = Service.Folder.GetTreeSize(tree);
            
            if (treeSize <= maxAcceptableSize) {
              Service.Folder.Download(tree, userData).then(() => {
                const folderName = App.services.Crypt.decryptName(tree.name, tree.parentId);
  
                Service.Folder.CreateZip(
                  `./downloads/${tree.id}/${folderName}.zip`,
                  [`downloads/${tree.id}/${folderName}`]
                );

                res.set('x-file-name', `${folderName}.zip`);
                res.download(`./downloads/${tree.id}/${folderName}.zip`);
  
                rimraf(`./downloads/${tree.id}`
                  , function () { console.log('Folder removed after send zip'); });
  
              }).catch((err) => {
                if (fs.existsSync(`./downloads/${tree.id}`)) {
                  rimraf(`./downloads/${tree.id}`
                  , function () { console.log('Folder removed after fail folder download'); });
                }

                res.status(402).json({ error: 'Error downloading folder' });
              });
            } else {
              res.status(402).json({ error: 'Folder too large' });
            }
            
          }).catch((err) => {
            if (fs.existsSync(`./downloads/${tree.id}`)) {
              rimraf(`./downloads/${tree.id}`
              , function () { console.log('Folder removed after fail folder download'); });
            }
            res.status(402).json({ error: 'Error downloading folder' });
          })
        } else {
          Service.Files.Download(userData, fileIdInBucket).then(({ filestream, mimetype, downloadFile, folderId }) => {
            const fileName = downloadFile.split('/')[2];
            const extSeparatorPos = fileName.lastIndexOf('.')
            const fileNameNoExt = fileName.slice(0, extSeparatorPos)
            const fileExt = fileName.slice(extSeparatorPos + 1);
            const decryptedFileName = App.services.Crypt.decryptName(fileNameNoExt, folderId);
  
            res.setHeader('Content-type', mimetype);
  
            const decryptedFileNameB64 = Buffer.from(`${decryptedFileName}.${fileExt}`).toString('base64')
            const encodedFileName = encodeURI(`${decryptedFileName}.${fileExt}`)

            res.setHeader('Content-disposition', `attachment; filename*=UTF-8''${encodedFileName}; filename=${encodedFileName}`);
            res.set('x-file-name', decryptedFileNameB64);
  
            filestream.pipe(res)
            fs.unlink(downloadFile, (error) => {
              if (error) throw error;
            });
          }).catch(({ message }) => {
            if (message === 'Bridge rate limit error') {
              res.status(402).json({ message })
              return;
            }
            res.status(500).json({ message })
          })
        }
        
      }).catch((err) => {
        console.error(err);
        res.status(500).send({ error: 'User not found' });
      });
    }).catch((err) => {
      console.error('Error', err);
      res.status(500).send({ error: 'Invalid token' });
    });
  });
}
