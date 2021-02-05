const fs = require('fs');
const path = require('path');

const sequelize = require('sequelize');
const SanitizeFilename = require('sanitize-filename');
const async = require('async');

const AesUtil = require('../../lib/AesUtil');

const { Op } = sequelize;

module.exports = (Model, App) => {
  const log = App.logger;

  const CreateFile = async (user, file) => {
    if (!file || !file.fileId || !file.bucket || !file.size || !file.folder_id || !file.name) {
      throw Error('Invalid metadata for new file');
    }

    return Model.folder.findOne({
      where: {
        id: { [Op.eq]: file.folder_id },
        user_id: { [Op.eq]: user.id }
      }
    }).then(async (folder) => {
      if (!folder) {
        throw Error('Folder not found / Is not your folder');
      }

      const fileExists = await Model.file.findOne({
        where: {
          name: { [Op.eq]: file.name },
          folder_id: { [Op.eq]: folder.id },
          type: { [Op.eq]: file.type }
        }
      });

      if (fileExists) {
        throw Error('File entry already exists');
      }

      const fileInfo = {
        name: file.name,
        type: file.type,
        size: file.size,
        folder_id: folder.id,
        fileId: file.file_id,
        bucket: file.bucket,
        encrypt_version: file.encrypt_version
      };

      try {
        AesUtil.decrypt(file.name, file.file_id);
        fileInfo.encrypt_version = '03-aes';
      } catch (e) {
        (() => { })(e);
      }

      if (file.date) {
        fileInfo.createdAt = file.date;
      }

      return Model.file.create(fileInfo);
    });
  };

  const GetNewMoveName = async (destination, originalName, type) => {
    let exists = true;
    let i = 1;
    let nextName;
    let nextCryptedName;
    while (exists) {
      nextName = App.services.Utils.getNewMoveName(originalName, i);
      nextCryptedName = App.services.Crypt.encryptName(App.services.Utils.getNewMoveName(originalName, i),
        destination);
      // eslint-disable-next-line no-await-in-loop
      exists = !!(await Model.file.findOne({
        where: {
          folder_id: { [Op.eq]: destination },
          name: { [Op.eq]: nextCryptedName },
          type: { [Op.eq]: type }
        },
        raw: true
      }));
      i += 1;
    }

    return { cryptedName: nextCryptedName, name: nextName };
  };

  const Upload = async (user, folderId, fileName, filePath) => {
    try {
      if (user.mnemonic === 'null') {
        throw new Error('Your mnemonic is invalid');
      }

      const sanitizedFilename = SanitizeFilename(fileName);

      if (fileName !== sanitizedFilename) {
        throw Error('Cannot upload, invalid file name');
      }

      log.info(`Starting file upload: ${fileName}`);

      const rootFolder = await Model.folder.findOne({
        where: { id: { [Op.eq]: user.root_folder_id } }
      });
      const folder = await Model.folder.findOne({
        where: { id: { [Op.eq]: folderId } }
      });

      if (!rootFolder.bucket) throw Error('Missing file bucket');

      // Separate filename from extension
      const fileNameParts = path.parse(fileName);

      let encryptedFileName = App.services.Crypt.encryptName(fileNameParts.name, folderId);

      const fileExt = fileNameParts.ext ? fileNameParts.ext.substring(1) : '';

      // Check if file already exists.
      const exists = await Model.file.findOne({
        where: {
          name: { [Op.eq]: encryptedFileName },
          folder_id: { [Op.eq]: folderId },
          type: { [Op.eq]: fileExt }
        }
      });

      // Change name if exists
      let originalEncryptedFileName;
      let newName;
      if (exists) {
        newName = await GetNewMoveName(folderId, fileNameParts.name, fileExt);
        encryptedFileName = newName.cryptedName;
        originalEncryptedFileName = App.services.Crypt.encryptName(newName.name,
          folderId);
      }

      originalEncryptedFileName = originalEncryptedFileName || App.services.Crypt.encryptName(fileNameParts.name, folderId);
      const originalEncryptedFileNameWithExt = `${originalEncryptedFileName}${fileExt ? `.${fileExt}` : ''}`;
      log.info('Uploading file to network');

      return App.services.Storj.StoreFile(user, rootFolder.bucket, originalEncryptedFileNameWithExt, filePath).then(async ({ fileId, size }) => {
        if (!fileId) throw Error('Missing file id');

        if (!size) throw Error('Missing file size');

        const newFileInfo = {
          name: encryptedFileName,
          type: fileExt,
          fileId,
          bucket: rootFolder.bucket,
          size
        };

        try {
          AesUtil.decrypt(encryptedFileName, folderId);
          newFileInfo.encrypt_version = '03-aes';
        } catch (e) {
          (() => { })(e);
        }

        const addedFile = await Model.file.create(newFileInfo);
        try {
          await folder.addFile(addedFile);
        } catch (e) {
          log.error('Cannot add file to non existent folder');
        }

        return addedFile;
      });
    } finally {
      fs.unlink(filePath, (error) => {
        if (error) throw error;
      });
    }
  };

  const Download = (user, fileId) => {
    const maxAcceptableSize = 1024 * 1024 * 1200; // 1200MB

    return new Promise((resolve, reject) => {
      if (user.mnemonic === 'null') throw new Error('Your mnemonic is invalid');

      Model.file
        .findOne({ where: { file_id: { [Op.eq]: fileId } } }).then((file) => {
          if (!file) {
            throw Error('File not found on database, please refresh');
          } else if (file.size > maxAcceptableSize) {
            // 1200MB
            throw Error('File too large');
          }

          App.services.Storj.ResolveFile(user, file).then((result) => {
            resolve({
              ...result, folderId: file.folder_id, name: file.name, type: file.type, raw: file, size: file.size
            });
          }).catch((err) => {
            if (err.message === 'File already exists') {
              resolve({ file: { name: `${file.name}${file.type ? `${file.type}` : ''}` } });
            } else {
              reject(err);
            }
          });
        }).catch(reject);
    });
  };

  const DownloadFolderFile = (user, fileId, localPath) => new Promise((resolve, reject) => {
    if (user.mnemonic === 'null') throw new Error('Your mnemonic is invalid');

    Model.file
      .findOne({ where: { file_id: { [Op.eq]: fileId } } }).then((file) => {
        if (!file) {
          throw Error('File not found on database, please refresh');
        }

        App.services.Storj.ResolveFolderFile(user, file, localPath).then((result) => {
          resolve({ ...result, folderId: file.folder_id });
        }).catch((err) => {
          if (err.message === 'File already exists') {
            resolve({ file: { name: `${file.name}.${file.type}` } });
          } else {
            reject(err);
          }
        });
      }).catch(reject);
  });

  const Delete = (user, bucket, fileId) => new Promise((resolve, reject) => {
    App.services.Storj.DeleteFile(user, bucket, fileId).then(async () => {
      const file = await Model.file.findOne({
        where: { fileId: { [Op.eq]: fileId } }
      });
      if (file) {
        const isDestroyed = await file.destroy();
        if (isDestroyed) {
          resolve('File deleted');
        } else {
          reject(Error('Cannot delete file'));
        }
      } else {
        reject(Error('File not found'));
      }
    }).catch(async (err) => {
      if (err.message.includes('Resource not found')) {
        const file = await Model.file.findOne({
          where: { fileId: { [Op.eq]: fileId } }
        });
        if (file) {
          await file.destroy();
        }

        resolve();
      } else {
        reject(err);
      }
    });
  });

  const DeleteFile = (user, folderid, fileid) => new Promise((resolve, reject) => {
    Model.file
      .findOne({ where: { id: fileid, folder_id: folderid } }).then((fileObj) => {
        if (!fileObj) {
          reject(new Error('Folder not found'));
        } else if (fileObj.fileId) {
          App.services.Storj.DeleteFile(user, fileObj.bucket, fileObj.fileId).then(() => {
            fileObj.destroy().then(resolve).catch(reject);
          }).catch((err) => {
            const resourceNotFoundPattern = /Resource not found/;

            if (resourceNotFoundPattern.exec(err.message)) {
              fileObj.destroy().then(resolve).catch(reject);
            } else {
              log.error('Error deleting file from bridge:', err.message);
              reject(err);
            }
          });
        } else {
          fileObj.destroy().then(resolve).catch(reject);
        }
      }).catch((err) => {
        log.error('Failed to find folder on database:', err.message);
        reject(err);
      });
  });

  const UpdateMetadata = (user, fileId, metadata) => new Promise((resolve, reject) => {
    const newMeta = {};

    async.waterfall([
      (next) => {
        // Find the file in database
        Model.file
          .findOne({ where: { fileId: { [Op.eq]: fileId } } }).then((file) => next(null, file)).catch(next);
      },
      (file, next) => {
        Model.folder
          .findOne({
            where: {
              id: { [Op.eq]: file.folder_id },
              user_id: { [Op.eq]: user.id }
            }
          }).then((folder) => {
            if (!folder) {
              next(Error('Update Metadata Error: Not your file'));
            } else {
              next(null, file);
            }
          }).catch(next);
      },
      (file, next) => {
        // If no name, empty string (only extension filename)
        const cryptoFileName = metadata.itemName
          ? App.services.Crypt.encryptName(metadata.itemName,
            file.folder_id)
          : '';

        // Check if there is a file with the same name
        Model.file
          .findOne({
            where: {
              folder_id: { [Op.eq]: file.folder_id },
              name: { [Op.eq]: cryptoFileName },
              type: { [Op.eq]: file.type }
            }
          }).then((duplicateFile) => {
            if (duplicateFile) {
              next(Error('File with this name exists'));
            } else {
              newMeta.name = cryptoFileName;
            }

            next(null, file);
          }).catch(next);
      },
      (file, next) => {
        if (newMeta.name !== file.name) {
          file
            .update(newMeta).then((update) => next(null, update)).catch(next);
        } else {
          next();
        }
      }
    ], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });

  const MoveFile = async (user, fileId, destination) => {
    const file = await Model.file.findOne({
      where: { fileId: { [Op.eq]: fileId } }
    });
    if (!file) {
      throw new Error('File not found');
    }

    const originalName = App.services.Crypt.decryptName(file.name,
      file.folder_id);
    let destinationName = App.services.Crypt.encryptName(originalName,
      destination);

    const exists = await Model.file.findOne({
      where: {
        name: { [Op.eq]: destinationName },
        folder_id: { [Op.eq]: destination },
        type: { [Op.eq]: file.type }
      }
    });

    // Change name if exists
    if (exists) {
      const newName = await GetNewMoveName(destination,
        originalName,
        file.type);
      destinationName = newName.cryptedName;
    }

    // Move
    const result = await file.update({
      folder_id: parseInt(destination, 10),
      name: destinationName
    });
    // we don't want ecrypted name on front
    file.setDataValue('name',
      App.services.Crypt.decryptName(destinationName, destination));
    file.setDataValue('folder_id', parseInt(destination, 10));
    const response = {
      result,
      item: file,
      destination,
      moved: true
    };

    return response;
  };

  const ListAllFiles = (user, bucketId) => new Promise((resolve, reject) => {
    App.services.Storj.ListBucketFiles(user, bucketId).then(resolve).catch((err) => reject(err.message));
  });

  const isFileOfTeamFolder = (fileId) => new Promise((resolve, reject) => {
    Model.file
      .findOne({
        where: {
          file_id: { [Op.eq]: fileId }
        },
        include: [
          {
            model: Model.folder,
            where: {
              id_team: { [Op.ne]: null }
            }
          }
        ]
      }).then((file) => {
        if (!file) {
          throw Error('File not found on database, please refresh');
        }

        resolve(file);
      }).catch(reject);
  });

  return {
    Name: 'Files',
    Upload,
    CreateFile,
    Delete,
    DeleteFile,
    Download,
    UpdateMetadata,
    GetNewMoveName,
    MoveFile,
    ListAllFiles,
    DownloadFolderFile,
    isFileOfTeamFolder
  };
};
