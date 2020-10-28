const fs = require('fs');

const rimraf = require('rimraf');
const _ = require('lodash');
const contentDisposition = require('content-disposition');

const upload = require('~middleware/multer');
const passport = require('~middleware/passport');

const { passportAuth } = passport;

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
  Router.get('/storage/folder/:id/:idTeam?', passportAuth, (req, res) => {
    const folderId = req.params.id;
    const teamId = req.params.idTeam || null;

    Service.Folder.GetContent(folderId, req.user, teamId)
      .then((result) => {
        if (result == null) {
          res.status(500).send([]);
        } else {
          res.status(200).json(result);
        }
      })
      .catch((err) => {
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
  Router.post('/storage/folder/:folderid/meta', passportAuth, (
    req,
    res
  ) => {
    const { user } = req;
    const folderId = req.params.folderid;
    const { metadata } = req.body;

    Service.Folder.UpdateMetadata(user, folderId, metadata)
      .then((result) => {
        res.status(200).json(result);
      })
      .catch((err) => {
        Logger.error(
          `Error updating metadata from folder ${folderId} : ${err}`
        );
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
    const { folderName } = req.body;
    const { parentFolderId } = req.body;
    

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

    Service.Folder.Delete(user, folderId)
      .then((result) => {
        res.status(204).json(result);
      })
      .catch((err) => {
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
  Router.post(
    '/storage/folder/:id/upload',
    passportAuth,
    upload.single('xfile'),
    (req, res) => {
      let { user } = req;
      // Set mnemonic to decrypted mnemonic
      user.mnemonic = req.headers['internxt-mnemonic'];
      const xfile = req.file;
      const folderId = req.params.id;

      Service.Folder.isFolderOfTeam(folderId)
        .then((folder) => {
          // Comprobamos si el usuario tiene ese email
          Service.TeamsMembers.getIdTeamByUser(user.email)
            .then((teamMember) => {
              // Si coincide el team con la carpeta del usuario
              if (folder.id_team === teamMember.id_team) {
                console.log('----- UPLOADING FOR TEAM -------');
                // Seleccionamos el id del team
                Service.Team.getTeamById(folder.id_team)
                  .then((team) => {
                    // Buscamos el email de ese usuario
                    Service.User.FindUserByEmail(team.bridge_user)
                      .then((userData) => {
                        // lo metemos en la base de datos
                        user = {
                          email: team.bridge_user,
                          userId: team.bridge_user,
                          mnemonic: team.bridge_password,
                          root_folder_id: userData.root_folder_id
                        };

                        Service.Files.Upload(
                          user,
                          folderId,
                          xfile.originalname,
                          xfile.path
                        )
                          .then((result) => {
                            res.status(201).json(result);
                          })
                          .catch((err) => {
                            Logger.error(`${err.message}\n${err.stack}`);
                            if (err.includes('Bridge rate limit error')) {
                              res.status(402).json({ message: err });

                              return;
                            }

                            res.status(500).json({ message: err });
                          });
                      })
                      .catch((err) => {});
                  })
                  .catch((err) => {
                    console.log(err);
                  });
              } else {
                return res.status(500).json({
                  message: 'You\'re not allowed to upload files on this folder'
                });
              }
            })
            .catch((err) => res.status(500).json({
              message: 'You\'re not allowed to upload files on this folder'
            }));
        })
        .catch((err) => {
          console.log('------ PERSONAL UPLOAD ------');
          Service.Files.Upload(user, folderId, xfile.originalname, xfile.path)
            .then((result) => {
              res.status(201).json(result);
            })
            .catch((err) => {
              Logger.error(`${err.message}\n${err.stack}`);
              if (err.includes('Bridge rate limit error')) {
                res.status(402).json({ message: err });

                return;
              }

              res.status(500).json({ message: err });
            });
        });
    }
  );

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

    Service.Folder.MoveFolder(user, folderId, destination)
      .then((result) => {
        res.status(200).json(result);
      })
      .catch((error) => {
        res.status(500).json(error);
      });
  });
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
  Router.post('/storage/file', passportAuth, (req, res) => {
    const { user } = req;
    const { file } = req.body;
    Service.Files.CreateFile(user, file)
      .then((result) => {
        res.status(200).json(result);
      })
      .catch((error) => {
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
    let { user } = req;
    // Set mnemonic to decrypted mnemonic
    user.mnemonic = req.headers['internxt-mnemonic'];
    const fileIdInBucket = req.params.id;
    if (fileIdInBucket === 'null') {
      return res.status(500).send({ message: 'Missing file id' });
    }

    let filePath;

    // PARA DESCARGAS
    Service.Files.isFileOfTeamFolder(fileIdInBucket)
      .then((file) => {
        Service.Team.getTeamById(file.folder.id_team)
          .then((team) => {
            Service.TeamsMembers.getIdTeamByUser(user.email)
              .then((teamMember) => {
                if (teamMember.id_team == file.folder.id_team) {
                  console.log('------ TEAM DOWNLOAD ------');

                  user = {
                    email: team.bridge_user,
                    userId: team.bridge_user,
                    mnemonic: team.bridge_password
                  };

                  return Service.Files.Download(user, fileIdInBucket)
                    .then(
                      ({
                        filestream,
                        mimetype,
                        downloadFile,
                        folderId,
                        name,
                        type
                      }) => {
                        filePath = downloadFile;
                        const fileName = downloadFile.split('/')[2];
                        const decryptedFileName = App.services.Crypt.decryptName(
                          name,
                          folderId
                        );

                        const fileNameDecrypted = `${decryptedFileName}${
                          type ? `.${type}` : ''
                        }`;
                        const decryptedFileNameB64 = Buffer.from(
                          fileNameDecrypted
                        ).toString('base64');

                        res.setHeader(
                          'content-disposition',
                          contentDisposition(fileNameDecrypted)
                        );
                        res.setHeader('content-type', mimetype);
                        res.set('x-file-name', decryptedFileNameB64);
                        filestream.pipe(res);
                        fs.unlink(filePath, (error) => {
                          if (error) throw error;
                        });
                      }
                    )
                    .catch((err) => {
                      if (err.message === 'Bridge rate limit error') {
                        return res.status(402).json({ message: err.message });
                      }

                      return res.status(500).json({ message: err.message });
                    });
                }

                return res.status(500).json({
                  message: 'You\'re not allowed to download files of this team'
                });
              })
              .catch((err) => res.status(500).json({
                message: 'You\'re not allowed to download files of this team'
              }));
          })
          .catch((err) => res.status(500).json({
            message: 'You\'re not allowed to download files of this team'
          }));
      })
      .catch((err) => {
        console.log('------- PERSONAL DOWNLOAD -------');

        return Service.Files.Download(user, fileIdInBucket)
          .then(
            ({
              filestream, mimetype, downloadFile, folderId, name, type
            }) => {
              filePath = downloadFile;
              const fileName = downloadFile.split('/')[2];
              const decryptedFileName = App.services.Crypt.decryptName(
                name,
                folderId
              );

              const fileNameDecrypted = `${decryptedFileName}${
                type ? `.${type}` : ''
              }`;
              const decryptedFileNameB64 = Buffer.from(
                fileNameDecrypted
              ).toString('base64');

              res.setHeader(
                'content-disposition',
                contentDisposition(fileNameDecrypted)
              );
              res.setHeader('content-type', mimetype);
              res.set('x-file-name', decryptedFileNameB64);
              filestream.pipe(res);
              fs.unlink(filePath, (error) => {
                if (error) throw error;
              });
            }
          )
          .catch((err) => {
            if (err.message === 'Bridge rate limit error') {
              return res.status(402).json({ message: err.message });
            }

            return res.status(500).json({ message: err.message });
          });
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

    Service.Files.UpdateMetadata(user, fileId, metadata)
      .then((result) => {
        res.status(200).json(result);
      })
      .catch((err) => {
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

    Service.Files.MoveFile(user, fileId, destination)
      .then((result) => {
        res.status(200).json(result);
      })
      .catch((error) => {
        res.status(500).json(error);
      });
  });

  /*
   * Delete file by bridge (mongodb) ids
   */
  Router.delete(
    '/storage/bucket/:bucketid/file/:fileid',
    passportAuth,
    (req, res) => {
      if (req.params.bucketid === 'null') {
        return res.status(500).json({ error: 'No bucket ID provided' });
      }

      if (req.params.fileid === 'null') {
        return res.status(500).json({ error: 'No file ID provided' });
      }

      const { user } = req;
      const bucketId = req.params.bucketid;
      const fileIdInBucket = req.params.fileid;

      return Service.Files.Delete(user, bucketId, fileIdInBucket)
        .then(() => {
          res.status(200).json({ deleted: true });
        })
        .catch((err) => {
          Logger.error(err.stack);
          res.status(500).json({ error: err.message });
        });
    }
  );

  /*
   * Delete file by database ids (mysql)
   */
  Router.delete(
    '/storage/folder/:folderid/file/:fileid',
    passportAuth,
    (req, res) => {
      Service.Files.DeleteFile(req.user, req.params.folderid, req.params.fileid)
        .then(() => {
          res.status(200).json({ deleted: true });
        })
        .catch((err) => {
          console.error('Error deleting file:', err.message);
          res.status(500).json({ error: err.message });
        });
    }
  );

  Router.post('/storage/shortLink', passportAuth, (req, res) => {
    const user = req.user.email;
    const { url } = req.body;

    Service.Share.GenerateShortLink(user, url)
      .then((shortLink) => {
        res.status(200).json(shortLink);
      })
      .catch((err) => {
        res.status(500).json({ error: err.message });
      });
  });

  Router.post('/storage/share/file/:id', passportAuth, (req, res) => {
    const user = req.user.email;

    Service.Share.GenerateToken(
      user,
      req.params.id,
      req.headers['internxt-mnemonic'],
      req.body.isFolder,
      req.body.views
    )
      .then((result) => {
        res.status(200).send(result);
      })
      .catch((err) => {
        res
          .status(402)
          .send(err.error ? err.error : { error: 'Internal Server Error' });
      });
  });

  Router.get('/storage/share/:token', (req, res) => {
    Service.Share.FindOne(req.params.token)
      .then((result) => {
        Service.User.FindUserByEmail(result.user)
          .then((userData) => {
            const fileIdInBucket = result.file;
            const isFolder = result.is_folder;

            userData.mnemonic = result.mnemonic;

            if (isFolder) {
              Service.Folder.GetTree({ email: result.user }, result.file)
                .then((tree) => {
                  const maxAcceptableSize = 1024 * 1024 * 300; // 300MB
                  const treeSize = Service.Folder.GetTreeSize(tree);

                  if (treeSize <= maxAcceptableSize) {
                    Service.Folder.Download(tree, userData)
                      .then(() => {
                        const folderName = App.services.Crypt.decryptName(
                          tree.name,
                          tree.parentId
                        );

                        Service.Folder.CreateZip(
                          `./downloads/${tree.id}/${folderName}.zip`,
                          [`downloads/${tree.id}/${folderName}`]
                        );

                        res.set('x-file-name', `${folderName}.zip`);
                        res.download(
                          `./downloads/${tree.id}/${folderName}.zip`
                        );

                        rimraf(`./downloads/${tree.id}`, () => {
                          console.log('Folder removed after send zip');
                        });
                      })
                      .catch((err) => {
                        if (fs.existsSync(`./downloads/${tree.id}`)) {
                          rimraf(`./downloads/${tree.id}`, () => {
                            console.log(
                              'Folder removed after fail folder download'
                            );
                          });
                        }

                        res
                          .status(402)
                          .json({ error: 'Error downloading folder' });
                      });
                  } else {
                    res.status(402).json({ error: 'Folder too large' });
                  }
                })
                .catch((err) => {
                  // if (fs.existsSync(`./downloads/${tree.id}`)) {
                  //   rimraf(`./downloads/${tree.id}`, function () {
                  //     console.log('Folder removed after fail folder download');
                  //   });
                  // }
                  res.status(402).json({ error: 'Error downloading folder' });
                });
            } else {
              Service.Files.Download(userData, fileIdInBucket)
                .then(
                  ({
                    filestream,
                    mimetype,
                    downloadFile,
                    folderId,
                    name,
                    type
                  }) => {
                    const decryptedFileName = App.services.Crypt.decryptName(
                      name,
                      folderId
                    );

                    res.setHeader('Content-type', mimetype);

                    const decryptedFileNameB64 = Buffer.from(
                      `${decryptedFileName}${type ? `.${type}` : ''}`
                    ).toString('base64');
                    const encodedFileName = encodeURI(
                      `${decryptedFileName}${type ? `.${type}` : ''}`
                    );

                    res.setHeader(
                      'content-disposition',
                      contentDisposition(encodedFileName)
                    );
                    res.set('x-file-name', decryptedFileNameB64);

                    filestream.pipe(res);
                    fs.unlink(downloadFile, (error) => {
                      if (error) throw error;
                    });
                  }
                )
                .catch(({ message }) => {
                  if (message === 'Bridge rate limit error') {
                    res.status(402).json({ message });

                    return;
                  }

                  res.status(500).json({ message });
                });
            }
          })
          .catch((err) => {
            console.error(err);
            res.status(500).send({ error: 'User not found' });
          });
      })
      .catch((err) => {
        console.error('Error', err);
        res.status(500).send({ error: 'Invalid token' });
      });
  });

  Router.post('/storage/sftp/list', passportAuth, (req, res) => {
    const fs_path = req.body.path;

    if (!fs_path) {
      return res.status(200).send({});
    }

    const replaced_path = fs_path.replace('\\', '/');
    const normalized_path = path.normalize(replaced_path);
    const splitted_path = normalized_path.split('/');
    const filtered_path = splitted_path.filter((x) => x !== '');

    if (filtered_path.length === 0) {
      return Service.Folder.GetContent(req.user.root_folder_id, req.user)
        .then((result) => {
          if (result == null) {
            res.status(500).send([]);
          } else {
            res.status(200).json(result);
          }
        })
        .catch((err) => {
          Logger.error(`${err.message}\n${err.stack}`);
          res.status(500).json(err);
        });
    }

    console.log('Sub-folders request is under construction', filtered_path);

    const position = 0;

    const findFolder = (folders, targetName) => new Promise((resolve, reject) => {
      async.eachSeries(
        folders,
        (folder, nextFolder) => {
          if (folder.name === targetName) {
            nextFolder('found', folder);
          } else {
            nextFolder();
          }
        },
        (err, folder) => {
          if (err === 'found') {
            resolve(folder);
          } else {
            reject();
          }
        }
      );
    });

    const getSubFolders = (folderId) => new Promise((resolve, reject) => {
      Service.Folder.GetContent(folderId, req.user)
        .then((result) => {
          resolve(result.children);
        })
        .catch((err) => {
          reject(err);
        });
    });

    const testUntil = (next) => {
      next(null, position < filtered_path.length);
    };

    const currentFolderId = req.user.root_folder_id;

    async.doDuring(
      (err) => {
        getSubFolders(currentFolderId).then((children) => {
          findFolder(folders, filtered_path[position])
            .then((result) => {})
            .catch((err) => {});
        });
      },
      testUntil,
      (err) => {
        if (err) {
          res.status(500).send({ error: 'Folder does not exists' });
        } else {
        }
      }
    );
  });
};
