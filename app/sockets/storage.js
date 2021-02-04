const rimraf = require('rimraf');
const fs = require('fs');
const jwt = require('jsonwebtoken')

module.exports = (App, Service, socket) => {
  socket.on('get-file-share', (content) => {
    if (content.token) {
      App.logger.info(content.token);
      Service.Share.FindOne(content.token).then((result) => {
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
                socket.emit(`get-file-share-${content.token}-length`, treeSize);

                Service.Folder.Download(tree, userData).then(() => {
                  const folderName = App.services.Crypt.decryptName(tree.name,
                    tree.parentId);

                  socket.emit(`get-file-share-${content.token}-fileName`, `${folderName}.zip`);

                  Service.Folder.CreateZip(`./downloads/${tree.id}/${folderName}.zip`,
                    [`downloads/${tree.id}/${folderName}`]);

                  const fileStream = fs.createReadStream(`./downloads/${tree.id}/${folderName}.zip`);

                  fileStream.on('data', (chunk) => {
                    socket.emit(`get-file-share-${content.token}-stream`, chunk);
                  });

                  fileStream.on('end', () => {
                    socket.emit(`get-file-share-${content.token}-finished`);
                    rimraf(`./downloads/${tree.id}`, () => {
                      // no op
                    });
                  });

                  fileStream.on('error', (err) => {
                    App.logger.info('Socket: Error streaming the file');
                    App.logger.info(err);
                    socket.emit(`get-file-share-${content.token}-error`, 'File stream error');
                    rimraf(`./downloads/${tree.id}`, () => {
                      // no op
                    });
                  });
                }).catch((err) => {
                  if (fs.existsSync(`./downloads/${tree.id}`)) {
                    rimraf(`./downloads/${tree.id}`, () => {
                      // no op
                    });
                  }
                  App.logger.info(err);
                  socket.emit(`get-file-share-${content.token}-error`, 'Folder download error');
                });
              } else {
                App.logger.info('Socket: file too large!');
                socket.emit(`get-file-share-${content.token}-error`, 'File too large error');
              }
            }).catch((err) => {
              App.logger.info(err);
              App.logger.info('Error downloading folder');
              socket.emit(`get-file-share-${content.token}-error`, 'Error downloading folder');
            });
          } else {
            socket.emit(`get-file-share-${content.token}-step-downloading-from-net`);

            Service.Files.Download(userData, fileIdInBucket).then(({
              filestream, downloadFile, folderId, name, type, size
            }) => {
              socket.emit(`get-file-share-${content.token}-step-decrypting`);
              socket.emit(`get-file-share-${content.token}-length`, size);

              const decryptedFileName = App.services.Crypt.decryptName(name, folderId);
              const fileName = `${decryptedFileName}${type ? `.${type}` : ''}`;

              socket.emit(`get-file-share-${content.token}-fileName`, fileName);

              filestream.on('data', (chunk) => {
                socket.emit(`get-file-share-${content.token}-stream`, chunk);
              });

              filestream.on('end', () => {
                socket.emit(`get-file-share-${content.token}-finished`);
                fs.unlink(downloadFile, (error) => {
                  if (error) throw error;
                });
              });

              filestream.on('error', (err) => {
                App.logger.info(err);
                socket.emit(`get-file-share-${content.token}-error`, 'File stream error');
                fs.unlink(downloadFile, (error) => {
                  if (error) throw error;
                });
              });
            }).catch(({ message }) => {
              if (message === 'Bridge rate limit error') {
                App.logger.info('Bridge rate limit error');
                socket.emit(`get-file-share-${content.token}-error`, 'Bridge rate limit error');
                return;
              }
              socket.emit(`get-file-share-${content.token}-error`, message);
            });
          }
        }).catch((err) => {
          App.logger.info(err);
          App.logger.info('User not found');
          socket.emit(`get-file-share-${content.token}-error`, 'User not found');
        });
      }).catch((err) => {
        App.logger.info(err);
        App.logger.info('Invalid token');
        socket.emit(`get-file-share-${content.token}-error`, 'Invalid token');
      });
    }
  });

  socket.on('get-file', async (content) => {
    const socketId = content.socketId;
    const user = content.user;
    user.mnemonic = content.mnemonic;
    const fileIdInBucket = content.fileId;

    try {
      jwt.verify(content.jwt, App.config.get('secrets').JWT);

      App.logger.info(`Socket id: ${socketId}`);
      App.logger.info(`mnemonic: ${user.mnemonic}`);
      App.logger.info(`file id: ${fileIdInBucket}`);

      if (fileIdInBucket) {
        let intervalId = setInterval(() => {
          socket.emit(`get-file-${socketId}-ping`);
        }, 2000);

        const response = await Service.Files.Download(user, fileIdInBucket);
        const { filestream, downloadFile, folderId, name, type, size } = response;

        const decryptedFileName = App.services.Crypt.decryptName(name, folderId);
        const fileName = `${decryptedFileName}${type ? `.${type}` : ''}`;

        socket.emit(`get-file-${socketId}-sending-data`, { size, fileName });

        filestream.on('data', (chunk) => {
          socket.emit(`get-file-${socketId}-stream`, chunk);
        });

        filestream.on('end', () => {
          clearInterval(intervalId);
          App.logger.info('finished');
          socket.emit(`get-file-${socketId}-finished`);
          fs.unlink(downloadFile, (error) => {
            if (error) throw error;
          });
        });

        socket.on('disconnect', () => clearInterval(intervalId));
      } else {
        throw new Error('Missing file id');
      }
    } catch (err) {
      socket.emit(`get-file-${socketId}-error`, { message: err.message });
    }
  });
};
