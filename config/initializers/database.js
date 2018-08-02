const Sequelize = require('sequelize')

module.exports = (config, Logger) => {
  const instance = new Sequelize(
    config.name,
    config.user,
    config.password, {
      host: config.host,
      dialect: 'mysql',
      operatorsAliases: false,
      logging: Logger.debug
    }
)

  instance.authenticate()
    .then(() => Logger.info('Connected to database'))
    .catch(err => Logger.info(err))

  return {
    instance,
    Sequelize
  }
}
