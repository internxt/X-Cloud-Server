require('dotenv').config();
const Server = require('./config/initializers/server');
const Routes = require('./app/routes/routes');
const Models = require('./app/models/models');
const Services = require('./app/services/services');
const Middleware = require('./config/initializers/middleware');
const SocketServer = require('./app/sockets/socketServer');

const App = new Server();

App.start(() => {
  App.initMiddleware(Middleware);
  App.initModels(Models);
  App.initServices(Services);
  App.initRoutes(Routes);
  App.initSocketServer(SocketServer);
  App.initGraphQL();
});
