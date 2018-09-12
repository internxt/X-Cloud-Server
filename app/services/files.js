module.exports = (Model, App) => {
  const Upload = (user, folderId, fileName, filePath) => {
    return new Promise(async (resolve, reject) => {
      const folder = await Model.folder.findOne({ where: { id: folderId } })
      const extSeparatorPos = fileName.lastIndexOf('.')
      const fileNameNoExt = fileName.slice(0, fileName.lastIndexOf('.'))
      const fileExt = fileName.slice(extSeparatorPos + 1)
      App.services.Storj.StoreFile(user, folder.bucket, fileName, filePath)
        .then(async (addedId) => {
          const addedFile = await Model.file.create({
            name: fileNameNoExt, type: fileExt, bucketId: addedId
          })
          const result = await folder.addFile(addedFile)
          resolve(addedFile)
        }).catch((err) => {
          reject(err.message)
        });
    });
  }

  const Download = (user, fileBucketId) => {
    return new Promise(async (resolve, reject) => {
      const file = await Model.file.find({ where: { bucketId: fileBucketId }, include: { model: Model.folder, as: 'folder' } })
      App.services.Storj.ResolveFile(user, file)
        .then((result) => {
          resolve({ file: result })
        }).catch((err) => {
          if (err.message === 'File already exists') {
            resolve({ file: { name: `${file.name}.${file.type}` } })
          }
          reject(err)
        });
    });
  }

  const Delete = (user, bucket, fileId) => {
    return new Promise((resolve, reject) => {
      App.services.Storj.DeleteFile(user, bucket, fileId)
        .then(async (result) => {
          const file = await Model.file.findOne({ where: { bucketId: fileId } })
          if (file) {
            const isDestroyed = await file.destroy()
            if (isDestroyed) {
              resolve('File deleted')
            } else {
              throw new Error('Cannot delete file')
            }
          } else {
            throw new Error('File not found')
          }
        }).catch((err) => {
          reject(err)
        })
    })
  }

  const ListAllFiles = (user, bucketId) => {
    return new Promise((resolve, reject) => {
      App.services.Storj.ListFiles(user, bucketId)
        .then((result) => {
          resolve(result)
        }).catch((err) => {
          reject(err.message)
        });
    })
  }

  return {
    Name: 'Files',
    Upload,
    Delete,
    Download,
    ListAllFiles
  }
}
