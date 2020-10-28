const { init } = require('nconf');
const passport = require('../middleware/passport');
const { passportAuth } = require('../middleware/passport');

module.exports = (Router, Service, Logger, App) => {
  Router.get('/teams/:user', passportAuth, async (req, res) => {
    const { user } = req.params;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.Team.getTeamByIdUser(user)
      .then((team) => {
        if(team) {
          res.status(200).json(team.dataValues);
        } else {
          res.status(200).json({});
        }                     
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });


  Router.post('/teams/initialize', passportAuth, async (req, res) => {
    const bridgeUser = req.body.email;
    const mnemonic = req.body.mnemonic;
    const user = req.user;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.User.InitializeUser({
      email: bridgeUser,
      mnemonic: mnemonic
      }).then((userData) => {
        Service.User.FindUserByEmail(bridgeUser).then((teamUser) => {
          userData.id = teamUser.id;
          userData.email = teamUser.email;
          userData.password = teamUser.password;
          userData.mnemonic = teamUser.mnemonic;
          //userData.root_folder_id = teamUser.root_folder_id;

          res.status(200).json({userData})
        }).catch((err) => {
          console.log('ERROR FINDING TEAM USER', err);
        });      

        res.status(200).json(initUser);
      }).catch((err) => {
        Logger.error(`${err.message}\n${err.stack}`);
        res.status(500).send(err.message);
      });

  });


  Router.get('/teams/getById/:id', passportAuth, async (req, res) => {
    const { id } = req.params;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.Team.getTeamById(id)
      .then((team) => {
        res.status(200).json(team.dataValues);
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });

  

  Router.delete('/teams/deleteTeam', passportAuth, async (req, res) => {
    const user = req.user;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.Team.getTeamByAdmin(user.email).then((findedTeam) => {
      Service.Team.deleteTeam(findedTeam.id).then(() => {
        Service.Team.deleteAllTeamMembers(findedTeam.id).then(() => {
          res.status(200).send({});
        }).catch((err) => { 
          res.status(500).send({});
        })  
      }).catch((err) => { 
        res.status(500).send({}); 
      })
    }).catch((err) => { 
      res.status(500).send({}); 
    })
  });

  Router.delete('/teams/deleteMember', passportAuth, async (req, res) => {
    const member = req.body.memberEmail;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.Team.deleteMember(member).then(() => {
      res.status(200).send({});
    }).catch((err) => {
      res.status(500).send({});
    });
  });
};
