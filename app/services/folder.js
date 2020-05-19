const _ = require('lodash')
const SanitizeFilename = require('sanitize-filename')
const sequelize = require('sequelize');
const async = require('async')
const fs = require('fs');
const stat = require('fs').statSync;
const AdmZip = require('adm-zip');

const Op = sequelize.Op;

module.exports = (Model, App) => {
  const FileService = require('./files')(Model, App);

  const Create = (user, folderName, parentFolderId) => {
    return new Promise(async (resolve, reject) => {
      try {
        // parent folder is yours?
        const existsParentFolder = await Model.folder.findOne({
          where: { id: { [Op.eq]: parentFolderId }, user_id: { [Op.eq]: user.id } }
        });

        if (!existsParentFolder) {
          console.warn('Parent folder is not yours')
          throw Error('Parent folder is not yours')
        }

        // Prevent strange folder names from being created
        const sanitizedFoldername = SanitizeFilename(folderName)

        if (folderName === "" || sanitizedFoldername !== folderName) {
          throw Error('Invalid folder name')
        }

        if (user.mnemonic === 'null') { throw Error('Your mnemonic is invalid'); }

        const cryptoFolderName = App.services.Crypt.encryptName(folderName, parentFolderId);

        const exists = await Model.folder.findOne({
          where: { parentId: { [Op.eq]: parentFolderId }, name: { [Op.eq]: cryptoFolderName } }
        });

        if (exists) {
          throw Error('Folder with the same name already exists');
        }

        // const bucket = await App.services.Storj.CreateBucket(user.email, user.userId, user.mnemonic, cryptoFolderName)

        const xCloudFolder = await user.createFolder({
          name: cryptoFolderName,
          bucket: null,
          parentId: parentFolderId || null
        })

        resolve(xCloudFolder);
      } catch (error) {
        reject(error);
      }
    });
  }

  const Delete = async (user, folderId) => {
    console.info('User %s requested to delete folder %s', user.email, folderId);

    if (user.mnemonic === 'null') { 
      return new Error('Your mnemonic is invalid');
    }

    const folder = await Model.folder.findOne({ where: { id: { [Op.eq]: folderId }, userId: { [Op.eq]: user.id } } });
    if (!folder) {
      return new Error('Folder does not exists');
    }
    
    console.log(folder.id);
    if (folder.id === user.root_folder_id) {
      return new Error('Cannot delete root folder');
    }

    if (folder.bucket) {
      await App.services.Storj.DeleteBucket(user, folder.bucket);
    }

    // Delete all the files in the folder
    // Find all subfolders and repeat
    const folderFiles = await Model.file.findAll({ where: { folder_id: folder.id } });
    const folderFolders = await Model.folder.findAll({ where: { parentId: folder.id } });
    await Promise.all(
      folderFiles.map(file => FileService.Delete(user, file.bucket, file.fileId))
        .concat(folderFolders.map(subFolder => Delete(user, subFolder.id)))
    );

    // Destroy folder
    await folder.destroy();
  }

  const CreateZip = (zipFileName, pathNames = []) => {
      const zip = new AdmZip();

      pathNames.forEach(path => {
          const p = stat(path);

          if (p.isFile()) {
              zip.addLocalFile(path);
          } else if (p.isDirectory()) {
              let zipInternalPath = path.split('/')[2];
              zip.addLocalFolder(path, zipInternalPath);
          }
      });

      zip.writeZip(zipFileName);
  }

  const Download = (tree, userData) => {
    return new Promise(async (resolve, reject) => {

      function traverseChildren(children, path = rootPath) {
        children.forEach(child => {
          const subFolder = App.services.Crypt.decryptName(child.name, child.parentId);

          fs.mkdir(`${path}/${subFolder}`, { recursive: true }, (err) => {
            if (err) throw err;
          });

          if (child.files && child.files.length > 0) {
            traverseFile(child.files, `${path}/${subFolder}`);
          }
  
          if (child.children && child.children.length > 0) {
            traverseChildren(child.children, `${path}/${subFolder}`);
          }
        });
      }
  
      function traverseFile(files, path = rootPath) {
        files.forEach(file => {
          listFilesToDownload.push({
            id: file.fileId,
            path: path
          });
        });
      }

      const rootFolder = App.services.Crypt.decryptName(tree.name, tree.parentId);
      const rootPath = `./downloads/${tree.id}/${rootFolder}`;
      var listFilesToDownload = [];
      
      fs.mkdir(rootPath, { recursive: true }, (err) => {
        if (err) throw err;
      });

      if (tree.files && tree.files.length > 0) {
        traverseFile(tree.files);
      }
  
      if (tree.children && tree.children.length > 0) {
        traverseChildren(tree.children);
      }

      async.eachSeries(listFilesToDownload, (file, next) => {
        FileService.DownloadFolderFile(userData, file.id, file.path).then(() => {
            next();
          }).catch((err) => {
            next(err);
          })
      }, (err) => {
        err ? reject(err) : resolve();
      });

    });
  }

  const GetTreeSize = (tree) => {
    let treeSize = 0;

    function getChildrenSize(children) {
      children.forEach(child => {
        if (child.files && child.files.length > 0) {
          getFileSize(child.files);
        }

        if (child.children && child.children.length > 0) {
          getChildrenSize(child.children);
        }
      });
    }

    function getFileSize(files) {
      files.forEach(file => {
        treeSize += file.size;
      });
    }

    if (tree.files && tree.files.length > 0) {
      getFileSize(tree.files);
    }

    if (tree.children && tree.children.length > 0) {
      getChildrenSize(tree.children);
    }

    return treeSize;
  }

  const GetTree = (user, rootFolderId = null) => {
    const username = user.email;

    return new Promise(async (resolve, reject) => {
      const userObject = await Model.users.findOne({ where: { email: { [Op.eq]: username } } });
      rootFolderId = !rootFolderId ? userObject.root_folder_id : rootFolderId;

      const rootFolder = await Model.folder.findOne({
        where: { id: { [Op.eq]: rootFolderId } },
        include: [{
          model: Model.folder,
          as: 'descendents',
          hierarchy: true,
          include: [{
            model: Model.file,
            as: 'files'
          }]
        },
        {
          model: Model.file,
          as: 'files'
        }]
      });

      resolve(rootFolder)
    });
  }

  const GetParent = (folder) => { }

  const mapChildrenNames = (folder = []) => {
    return folder.map((child) => {
      child.name = App.services.Crypt.decryptName(child.name, child.parentId);
      child.children = mapChildrenNames(child.children)
      return child;
    });
  }


  const GetContent = async (folderId, user) => {
    const result = await Model.folder.findOne({
      where: {
        id: { [Op.eq]: folderId },
        user_id: user.id
      },
      include: [{
        model: Model.folder,
        as: 'descendents',
        hierarchy: true,
        include: [
          {
            model: Model.icon,
            as: 'icon'
          }
        ]
      },
      {
        model: Model.file,
        as: 'files'
      },
      {
        model: Model.icon,
        as: 'icon'
      }
      ]
    });

    // Null result implies empty folder.
    // TODO: Should send an error to be handled and showed on website.

    if (result !== null) {
      result.name = App.services.Crypt.decryptName(result.name, result.parentId);
      result.children = mapChildrenNames(result.children)
      result.files = result.files.map((file) => {
        file.name = `${App.services.Crypt.decryptName(file.name, file.folder_id)}`;
        return file;
      })
    }
    return result
  }

  const UpdateMetadata = (user, folderId, metadata) => {
    return new Promise((resolve, reject) => {
      const newMeta = {}

      async.waterfall([
        (next) => {
          // Is there something to change?
          if (!metadata.itemName && !metadata.icon && !metadata.color) {
            next(Error('Nothing to change'))
          } else {
            next()
          }
        },
        (next) => {
          // Get the target folder from database
          Model.folder.findOne({ where: { id: { [Op.eq]: folderId } } })
            .then(result => next(null, result))
            .catch(next)
        },
        (folder, next) => {
          // Check if user is the owner of that folder
          if (folder.user_id !== user.id) {
            next(Error('Update Folder Metadata: This is not your folder'))
          } else {
            next(null, folder)
          }
        },
        (folder, next) => {
          // Check if the new folder name already exists
          if (metadata.itemName) {
            const cryptoFolderName = App.services.Crypt.encryptName(metadata.itemName, folder.parentId);

            Model.folder.findOne({
              where: { parentId: { [Op.eq]: folder.parentId }, name: { [Op.eq]: cryptoFolderName } }
            }).then((isDuplicated) => {
              if (isDuplicated) {
                next(Error('Folder with this name exists'))
              } else {
                newMeta.name = cryptoFolderName
                next(null, folder)
              }
            }).catch(next)
          } else {
            next(null, folder)
          }
        },
        (folder, next) => {
          // Set optional changes
          if (metadata.color) { newMeta.color = metadata.color }
          if (typeof metadata.icon === 'number' && metadata.icon >= 0) { newMeta.icon_id = metadata.icon }
          next(null, folder)
        },
        (folder, next) => {
          // Perform the update
          folder.update(newMeta).then(result => next(null, result)).catch(next)
        }
      ], (err, result) => {
        if (err) { reject(err) } else { resolve(result) }
      })
    })
  }

  const GetBucketList = (user) => {
    return new Promise((resolve, reject) => {
      App.services.Storj.ListBuckets(user).then(resolve).catch(reject)
    })
  }

  const CombineFolder = async (
    user,
    folderData,
    destFolderTree,
    destinationPath,
    mainFolder,
    replaceAll = false,
    combineAll = false,
    resultAcum = { success: 0, overwrites: 0, combines: 0, errors: 0, removedFolders: [], results: [] }
  ) => {
    function getMoveErrs(moveOps) {
      return moveOps.filter(moveOp => moveOp && moveOp.error);
    }

    function getFileOverwriteErrs(moveOps) {
      return moveOps.filter(moveOp => moveOp.error && moveOp.error.message && moveOp.error.message.includes('same name'));
    }

    function getFolderCombineErrs(moveCombinesOps) {
      let moveOps = moveCombinesOps.reduce((allResults, childResult) => allResults.concat(childResult.error.map(error => { return { error: error.error, item: error.item, destination: error.destination }})), []);
      return moveOps.filter(moveOp => moveOp.error && moveOp.error.message && moveOp.error.message.includes('same name') && !moveOp.item.fileId);
    }

    function getFolderOverwriteErrs(moveCombinesOps) {
      let moveOps = moveCombinesOps.reduce((allResults, childResult) => allResults.concat(childResult.error.map(error => { return { error: error.error, item: error.item, destination: error.destination }})), []);
      return moveOps.filter(moveOp => moveOp.error && moveOp.error.message && moveOp.error.message.includes('same name') && !!moveOp.item.fileId);
    }

    function getRemovedFolders(moveOps) {
      return moveOps.reduce((removedFolders, childResult) => removedFolders.concat(childResult.removedFolders), []);
    }

    function getFileNotOverwriteErrs(moveOps) {
      return moveOps.filter(moveOp => moveOp.error && moveOp.error.message && !moveOp.error.message.includes('same name'));
    }

    function getSuccessMoveOps(moveOps) {
      return moveOps.filter(moveOp => !moveOp.error);
    }

    function getFolderNotOverwriteErrs(moveOps) {
      if (!moveOps.length) {
        return [];
      }

      let errors = moveOps.reduce((allResults, childResult) => allResults.concat(childResult.error), []);
      return errors.filter(moveOp => moveOp.error && moveOp.error.message && !moveOp.error.message.includes('same name'));
    }

    function setResultAccumEnd(removedFolders) {
      removedFolders = removedFolders.concat(folderData.folder.id);
      resultAcum.success += 1;
      resultAcum.results.push({
        item: folderData.folder,
        destination: { id: destFolderTree.id, destinationPath },
        overwrites: [],
        combines: [],
        removedFolders,
        errors: [],
        success: 1
      });
      resultAcum.removedFolders = resultAcum.removedFolders.concat(removedFolders);
    }

    function setResultAccum(result) {
      resultAcum.overwrites += result.overwrites.length;
      resultAcum.combines += result.combines.length;
      resultAcum.removedFolders = resultAcum.removedFolders.concat(result.removedFolders || []),
      resultAcum.errors += result.errors.length;
      resultAcum.success += result.success;
      resultAcum.results.push(result);
    }

    function setResultAccumFromCombines(combinesResult) {
      combinesResult.forEach(combineResult => {
        resultAcum.overwrites += combineResult.overwrites;
        resultAcum.combines += combineResult.combines;
        resultAcum.errors += combineResult.errors;
        resultAcum.success += combineResult.success;
        resultAcum.results = resultAcum.results.concat(combineResult.results);
      });
    }

    function getResult(destination, overwrites, combines, removedFolders, success, errors) {
      return {
        destination,
        overwrites,
        combines,
        removedFolders,
        success,
        errors
      };
    }

    function isSuccessfulResult(result) {
      if (!result) {
        return true;
      }

      return !result.overwrites.length && !result.combines.length && !result.errors.length;
    }

    function isSuccessfulCombinesResults(results) {
      let success = true;
      if (!results || !results.length) {
        return success;
      }

      let i = results.length;
      let result;
      while (success || i !== 0) {
        result = results[i - 1];
        success = result.overwrites + result.combines + result.errors;
        i -= 1;
      }

      return success;
    }

    function isSuccessfulMoved(overwriteResult, combinesResult) {
      return isSuccessfulResult(overwriteResult) && isSuccessfulCombinesResults(combinesResult);
    }

    // Parallel combine folders returning result for combining
    async function combine(folders, files, destination) {
      let movedFiles = []; 
      let movedFilesErrs = [];
      if (files.length) {
        movedFiles = await Promise.all(files.map(file => FileService.MoveFile(user, file.fileId, destination, mainFolder, replaceAll, true, destinationPath)));
        movedFilesErrs = getMoveErrs(movedFiles);
      }
      
      let movedFolders = [];
      let moveFoldersErrs = [];
      if (folders.length) {
        movedFolders = await Promise.all(folders.map(folder => MoveFolder(user, folder.id, destination, mainFolder, combineAll, replaceAll, combineAll, true, destinationPath)));
        moveFoldersErrs = getMoveErrs(movedFolders);
      }

      // Get other than exists errors
      const moveErrs = getFileNotOverwriteErrs(movedFilesErrs).concat(getFolderNotOverwriteErrs(moveFoldersErrs));
      // Get non errors for nested folders on backwards
      const moveSuccess = getSuccessMoveOps(movedFiles.concat(movedFolders));

      return getResult(
        destination,
        getFileOverwriteErrs(movedFilesErrs).concat(getFolderOverwriteErrs(moveFoldersErrs)),
        getFolderCombineErrs(moveFoldersErrs),
        getRemovedFolders(moveSuccess),
        moveSuccess.length,
        moveErrs,
      );
    }

    // Parallel overwrites files returning result for combining
    async function overwrite(overwrites) {
      const overwritedFiles = await Promise.all(overwrites.map(overwrite => FileService.MoveFile(user, overwrite.item.fileId, overwrite.destination.id, mainFolder, true, true, overwrite.destination.destinationPath)));
      const overwritedFilesErrs = getMoveErrs(overwritedFiles);
      // Get other than exists errors
      const overWriteErrs = getFileNotOverwriteErrs(overwritedFilesErrs);
      // Get non errors for nested folders removed on backwards
      const moveSuccess = getSuccessMoveOps(overwritedFiles);

      return getResult(
        destination,
        getFileOverwriteErrs(overWriteErrs),
        [],
        getRemovedFolders(moveSuccess),
        moveSuccess.length,
        overWriteErrs,
      );
    }

    // Nested folders
    const folders = folderData.folderTree.children;
    // Nested files
    const files = folderData.folderTree.files;
    const destination = destFolderTree.id;
    let combineResult;
    if (folders.length || files.length) {
      combineResult = await combine(folders, files, destination);
    }

    // Combining empty folder...or successful combine result
    if (!combineResult || isSuccessfulResult(combineResult)) {
      await Delete(user, folderData.folder.id);
      const children = await GetChildren(user, mainFolder, { attributes: ['id']});
      const childrenIds = children.map(child => child.id);
      setResultAccumEnd(await removeEmptyFolderParents(user, folderData.folder.parentId, mainFolder, childrenIds));
      return resultAcum;
    }

    // Accumulate combine results
    setResultAccum(combineResult);
    if (combineResult.errors.length || (combineResult.overwrites.length && !replaceAll) || (combineResult.combines.length && !combineAll)) {
      return resultAcum;
    }

    let overwritesResult;
    // If we have overwrites from previous call and we can replace them all
    if (combineResult.overwrites.length && replaceAll) {
      overwritesResult = await overwrite(combineResult.overwrites);
      // Accumulate overwrites results
      setResultAccum(overwritesResult);
      if (overwritesResult.errors.length) {
        console.log(JSON.stringify(resultAcum));
        return resultAcum;
      }
    }

    let conmbinesResults;
    // If we have combines from previous call and we can combine them all
    if (combineResult.combines.length && combineAll) {
      conmbinesResults = await Promise.all(
        combineResult.combines.map(async toCombineFolder => 
          CombineFolder(
            user, 
            { folderTree: await GetTree(user, toCombineFolder.item.id), folder: toCombineFolder.item }, 
            await GetTree(user, toCombineFolder.destination.id), 
            toCombineFolder.destination.destinationPath,
            destination,
            replaceAll,
            true
          )
        )
      );
      // Accumulate combines results
      setResultAccumFromCombines(conmbinesResults);
      if (conmbinesResults.errors.length) {
        return resultAcum;
      }
    }

    if (isSuccessfulMoved(overwritesResult, conmbinesResults)) {
      // I was combined, remove me!
      await Delete(user, folderData.folder.id);
      const children = await GetChildren(user, mainFolder, { attributes: ['id']});
      const childrenIds = children.map(child => child.id);
      // And get empty parents folder for deleting in case they are empty...and add them in removedFolders result accum
      setResultAccumEnd(await removeEmptyFolderParents(user, folderData.folder.parentId, mainFolder, childrenIds));
    }
    
    return resultAcum;
  }
  
  const removeEmptyFolderParents = async (user, parentId, limitId, childrens) => {
    // Go back on the tree and delete folders
    if (parentId && parentId !== limitId) {
      const folder = await Model.folder.findOne({ where: { id: { [Op.eq]: parentId }, user_id: { [Op.eq]: user.id }}, raw: true });
      const parentHasFolders = await Model.folder.findOne({ where: { parent_id: { [Op.eq]: parentId }, user_id: { [Op.eq]: user.id } }});
      const parentHasFiles = await Model.file.findOne({ where: { folder_id: { [Op.eq]: parentId } }});
      if (!parentHasFolders && !parentHasFiles) {
        await Delete(user, folder.id);
        // We actually want only removed folders ids from current front list view
        if (childrens.includes(parentId)) {
          return [parentId].concat(await removeEmptyFolderParents(user, folder.parentId, limitId, childrens));
        }

        // If not...we do not include it for controlling array nested size
        return [].concat(await removeEmptyFolderParents(user, folder.parentId, limitId, childrens));
      }
    }

    return [];
  }

  const GetChildren = async (user, folderId, options = {}) => {
    const query = {
      where: {
        user_id: { [Op.eq]: user.id },
        parent_id: { [Op.eq]: folderId }
      },
      raw: true
    };

    if (options.attributes) {
      query.attributes = options.attributes;
    }

    return Model.folder.findAll(query);
  }

  const MoveFolder = (user, folderId, destination, mainFolder, combine = false, replaceAll = false, combineAll = false, isCombining = false, destinationPath = '') => {
    function resolveOrReject(response, resolve, reject) {
      if (isCombining) {
        response.error = [response.error];
        return resolve(response);
      }

      return reject(response);
    }

    return new Promise(async (resolve, reject) => {
      let response;
      const folder = await Model.folder.findOne({ where: { id: { [Op.eq]: folderId } }, raw: true })
      const destinationFolder = await Model.folder.findOne({ where: { id: { [Op.eq]: destination } } })

      if (!folder || !destinationFolder) {
        response = { error: { message: 'Folder does not exists' }, item: folder, destination };
        return resolveOrReject(response, resolve, reject);
      }

      const originalName = App.services.Crypt.decryptName(folder.name, folder.parentId)
      // we don't want ecrypted name on front
      folder.name = originalName;
      const destinationName = App.services.Crypt.encryptName(originalName, destination)
      destinationPath = destinationPath + '/' + originalName;

      const exists = await Model.folder.findOne({
        where: {
          name: { [Op.eq]: destinationName },
          parent_id: { [Op.eq]: destination }
        }
      })

      if (exists && !combine) {
        response = { error: { message: 'Destination contains a folder with the same name' }, item: folder, destination: { id: destination, destinationPath }};
        return resolveOrReject(response, resolve, reject);
      }

      try {
        if (user.mnemonic === 'null') throw new Error('Your mnemonic is invalid');

        if (exists && combine) {
          const toCombineFolder = { folderTree: await GetTree(user, folderId), folder };
          const destFolderTree = await GetTree(user, exists.id);
          const result = await CombineFolder(user, toCombineFolder, destFolderTree, destinationPath, mainFolder, replaceAll, combineAll);
          const errors = result.results.reduce((allResults, childResult) => allResults.concat(childResult.overwrites, childResult.combines, childResult.errors), []);
          if (isCombining) {
            response = { error: errors, item: folder, destination: { id: exists.id, destinationPath } };
            return resolve(response);
          }

          response = { result, removedFolders: result.removedFolders, item: folder, destination: { id: destination, destinationPath } };
          if (replaceAll && combineAll) {
            return resolve(response);
          } else if ((result.overwrites > 0 && !replaceAll) || (result.combines > 0 && !combineAll)) {
            response.error = { message: 'Destination contains a folder with the same name' };
            return reject(response);
          } else if (result.errors > 0) {
            response.error = { message: 'Combine folder error' };
            return reject(response);
          } else {
            return resolve(response);
          }
        } else {
          const previousParentFolder = folder.parentId;
          folder.parentId = destination;
          folder.name = destinationName;
          const result = await Model.folder.update(folder, { where: { id: folder.id }});
          // we don't want ecrypted name on front
          folder.name = originalName;
          response = { result, item: folder, destination: { id: destination, destinationPath }};
          if (previousParentFolder === mainFolder) {
            return resolve(response);
          }

          // came from nested 'combine', check backwards origin parent folder and parent parents folders and remove them if they're empty
          const children = await GetChildren(user, mainFolder, { attributes: ['id']});
          const childrenIds = children.map(child => child.id);
          response.removedFolders = await removeEmptyFolderParents(user, previousParentFolder, mainFolder, childrenIds);
          resolve(response);
        }
      } catch (error) {
        response = { error: { message: error.message }, item: folder, destination: { id: destination, destinationPath } };
        return resolveOrReject(response, resolve, reject);
      }
    })
  }

  return {
    Name: 'Folder',
    Create,
    Delete,
    GetChildren,
    GetTree,
    GetTreeSize,
    GetParent,
    GetContent,
    UpdateMetadata,
    GetBucketList,
    MoveFolder,
    Download,
    CreateZip,
    removeEmptyFolderParents
  }
}
