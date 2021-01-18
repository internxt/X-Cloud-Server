const path = require('path');

const async = require('async');

const { passportAuth } = require('../middleware/passport');
const logger = require('../../lib/logger');

const Logger = logger.getInstance();

module.exports = (Router, Service) => {
  Router.get('/storage/tree', passportAuth, (req, res) => {
    const { user } = req;

    Service.Folder.GetTree(user).then((result) => {
      res.status(200).send(result);
    }).catch((err) => {
      res.status(500).send({ error: err.message });
    });
  });

  Router.get('/desktop/tree', passportAuth, (req, res) => {
    const { user } = req;

    Service.Folder.GetFolders(user).then((result) => {
      res.status(200).send(result);
    }).catch((err) => {
      res.status(500).send({ error: err.message });
    });
  });

  Router.put('/user/sync', passportAuth, (req, res) => {
    const { user, body } = req;
    Service.User.UpdateUserSync(user, body.toNull).then((result) => {
      res.status(200).json({ data: result });
    }).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  });

  Router.get('/user/sync', passportAuth, (req, res) => {
    const { user } = req;
    res.setHeader('Content-Type', 'application/json');
    Service.User.GetOrSetUserSync(user).then((result) => {
      res.status(200).json({ data: result });
    }).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  });

  Router.delete('/user/sync', passportAuth, (req, res) => {
    const { user } = req;
    Service.User.UnlockSync(user).then(() => {
      res.status(200).send();
    }).catch(() => {
      res.status(500).send();
    });
  });

  Router.post('/storage/exists', passportAuth, (req, res) => {
    const rootFolderId = req.user.root_folder_id;
    let targetPath = req.body.path;

    // Create subdirectories if not exists
    const mkdirp = !!req.body.mkdirp;

    // Basename is file or folder
    const findFile = !!req.body.isFile;

    // win32 normalization converts all "/" to "\". Posix doesn't
    targetPath = path.win32.normalize(targetPath);

    // If is a relative path, and is not ref to root folder, is an invalid path
    if (targetPath.substring(0, 1) === '.' && targetPath !== '.' && targetPath !== '.\\') {
      return res.status(501).send({ error: 'Invalid path' });
    }

    // If path es "." or "./" or "./././"..., is the root folder. Just ok
    if (targetPath === '.' || targetPath === '.\\') {
      return Service.Folder.GetBucket(req.user, rootFolderId).then((folder) => {
        folder.name = Service.Crypt.decryptName(folder.name);
        res.status(200).send({ result: 'ok', isRoot: true, path: folder });
      });
    }

    let splitted = targetPath.split('\\');
    splitted = splitted.filter((e) => e !== '');

    const GetChildren = async (folderId, match) => new Promise((resolve, reject) => {
      Service.Folder.GetChildren(req.user, folderId).then((result) => {
        async.eachSeries(result, (folder, nextItem) => {
          const name = Service.Crypt.decryptName(folder.name, folderId);
          if (name === match) {
            folder.name = name;
            nextItem(folder);
          } else {
            nextItem();
          }
        }, (err) => {
          if (err) {
            if (typeof err === 'object') { resolve(err); } else { reject(err); }
          } else {
            reject();
          }
        });
      });
    });

    const GetFiles = async (folderId, match) => new Promise((resolve, reject) => {
      Service.Folder.GetContent(folderId, req.user).then((result) => {
        async.eachSeries(result.files, (file, nextFile) => {
          const fileName = file.name + (file.type ? `.${file.type}` : '');
          if (fileName === match) {
            nextFile(file);
          } else {
            // console.log('No match %s', fileName)
            nextFile();
          }
        }, (err) => {
          if (err) {
            if (typeof err === 'object') { resolve(err); } else { reject(err); }
          } else {
            reject();
          }
        });
      });
    });

    let lastFolderId = rootFolderId;
    let i = 0;
    const pathResults = [];

    return async.eachSeries(splitted, (targetFolder, nextFolder) => {
      // console.log('Searching for %s on folder %s', targetFolder, lastFolderId)
      const isLastElement = i === splitted.length - 1;
      i += 1;

      if (!isLastElement || !findFile) {
        GetChildren(lastFolderId, targetFolder).then((result) => {
          lastFolderId = result.id;
          result.isFile = false;
          pathResults.push(result);
          nextFolder();
        }).catch(() => {
          if (mkdirp) {
            Service.Folder.Create(req.user, targetFolder, lastFolderId).then((result) => {
              lastFolderId = result.id;
              nextFolder();
            }).catch((err1) => {
              nextFolder(err1);
            });
          } else {
            nextFolder(Error('Folder does not exists'));
          }
        });
      }

      if (isLastElement && findFile) {
        GetFiles(lastFolderId, targetFolder).then((result) => {
          result.dataValues.isFile = true;
          pathResults.push(result);
          nextFolder();
        }).catch(() => {
          nextFolder(Error('File does not exists'));
        });
      }
    }, (err) => {
      // console.log('FIN')
      if (err) {
        res.status(501).send({ error: err.message });
      } else {
        // console.log(pathResults)
        res.status(200).send({ result: 'ok', isRoot: false, path: pathResults });
      }
    });
  });

  Router.delete('/storage/file', passportAuth, (req, res) => {
    const { user } = req;
    const { file } = req.body;

    Service.Files.RemoveFileEntry(user, file).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      Logger.error(error);
      res.status(400).json({ error: error.message });
    });
  });
};
