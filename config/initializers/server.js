const express = require('express');
const { graphqlHTTP } = require('express-graphql');
const Logger = require('../../lib/logger');
const Config = require('../config');
const Database = require('./database');
const graphQLSchema = require('../../app/graphql/index.schema');
const rootGraphQL = require('../../app/graphql/index.root');

/**
 * Instance of Server application
 * @param {Config} config
 */

class Server {
  constructor() {
    this.config = Config.getInstance();
    this.logger = Logger.getInstance();
    this.express = express();
    this.router = express.Router();
    this.instance = null;
    this.database = null;
    this.models = null;
    this.services = null;
    this.routes = null;
  }

  start(callback) {
    const port = this.config.get('server:port');
    this.logger.info(`Starting Server on port ${port}`);
    this.logger.info(`Environment: "${process.env.NODE_ENV}"`);
    this.instance = this.express.listen(port, '0.0.0.0', callback);
    this.initDatabase();

    process.on('SIGINT', this.handleSIGINT.bind(this));
    process.on('exit', this.handleExit.bind(this));
    process.on('uncaughtException', this.handleuncaughtException.bind(this));

    this.logger.info(`Server started on port: http://localhost:${port}`);
    this.logger.info(`Brigde location: ${this.config.get('STORJ_BRIDGE')}`);
  }

  handleuncaughtException(err) {
    this.logger.info('Unhandled exception: %s\n%s', err.message, err.stack);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }

  handleExit() {
    this.logger.info('Server is shutting down');
  }

  handleSIGINT() {
    const { logger } = this;
    logger.info('Server received shutdown request, waiting for pending requests');
    this.instance.close(() => {
      logger.info('Finished all requests');
      process.exitCode = 0;
    });
  }

  initDatabase() {
    this.logger.info('Connecting to database');
    this.database = Database(this.config.get('database'));
  }

  initModels(Models) {
    this.logger.info('Initializing Models');
    this.models = Models(this.database, this);
    this.logger.info('Models OK');
  }

  initServices(Services) {
    this.logger.info('Initializing services');
    this.services = Services(this.models, this);
    this.logger.info('Services OK');
  }

  initMiddleware(Middleware) {
    this.logger.info('Initializing middleware');
    Middleware(this, this.config.get('secrets'));
    this.logger.info('Middleware OK');
  }

  initSocketServer(SocketServer) {
    this.logger.info('Initializing socket server');
    SocketServer(this, this.services);
    this.logger.info('Socket Server OK');
  }

  initRoutes(Router) {
    const routesPrefix = '/api';
    this.logger.info(`Initializing and mounting routes to ${routesPrefix}`);
    this.routes = Router(this.router, this.services, this);
    this.express.use(routesPrefix, this.routes);
    this.logger.info('Routes OK');
  }

  initGraphQL() {
    this.express.use('/api/v2', graphqlHTTP({
      schema: graphQLSchema,
      rootValue: rootGraphQL,
      graphiql: true
    }));
  }
}

module.exports = Server;
