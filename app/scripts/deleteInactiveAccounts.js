require('dotenv').config();

const UserModel = require('./../models/user');
const FolderModel = require('./../models/folder');
const { Environment } = require('storj');
const Sequelize = require('sequelize');
const Op = Sequelize.Op;

const sequelize = new Sequelize(
    process.env.RDS_DBNAME,
    process.env.RDS_USERNAME,
    process.env.RDS_PASSWORD,
    {
        host: process.env.RDS_HOSTNAME,
        dialect: 'mysql',
        operatorsAliases: 0,
        logging: null
    }
);
const User = UserModel(sequelize, Sequelize);
const Folder = FolderModel(sequelize, Sequelize);

const getBucket = (folderId) => {
    return new Promise((resolve, reject) => {
        Folder.findOne({
            where: { id: { [Op.eq]: folderId } }
        }).then( res => resolve(res.bucket) ).catch(reject);
    });
}

const deleteRootBucket = (user, bucketId) => {    
    return new Promise((resolve, reject) => {
        try {
            var storj = new Environment({
                bridgeUrl: process.env.STORJ_BRIDGE,
                bridgeUser: user.email,
                bridgePass: user.userId,
                logLevel: 3
            });
        } catch (error) {
            console.error('[NODE-LIB getEnvironment]', error);
            reject(err)
        }

        storj.deleteBucket(bucketId, function (err, result) {
            if (err) { 
                console.error(err);
                reject(err)
            } else { 
                console.log(result);
                resolve(result) 
            }
        });
    });
}

const getUnconfirmedUsers = () => {
    var yearAgo = new Date();
    yearAgo.setMonth(yearAgo.getMonth() - 12);

    return new Promise((resolve, reject) => {
        User.findAll({
            where: {
                updatedAt: {
                    [Op.lt]: yearAgo
                },
                is_email_activity_sended: {
                    [Op.eq]: true
                }
            }
        })
        .then((res) => { resolve(res) })
        .catch(reject);
    });
}

const init = () => {
    sequelize.authenticate().then(() => {
        getUnconfirmedUsers().then((users) => {
            users.forEach(user => {
                console.log(user.email);

                if (user.root_folder_id) {
                    getBucket(user.root_folder_id).then((bucketId) => {
                        console.log('kkkkkkkkkkkkk');
                        console.log(bucketId);

                        deleteRootBucket(user, bucketId).then((res) => {
                            console.log(res);
                        }).catch((err) => {
                            console.error(err);
                        });
                    }).catch((err) => {
                        console.error(err);
                    });
                }
            });
        }).catch((err) => {
            console.error(err);
        });
    }).catch((err) => {
        console.error(err);
    });
}

setInterval(init, 60000 * 60 * 24)