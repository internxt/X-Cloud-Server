const passport = require('../middleware/passport');
const { passportAuth } = require('../middleware/passport');

module.exports = (Router, Service, Logger, App) => {
  Router.get('/teams/:user', passportAuth, (req, res) => {
    const { user } = req.params;
    console.log("TEAM USER", user); //debug

    Service.Team.getTeamByIdUser(user)
      .then((team) => {
        if(team) {
          console.log("USER TEAM", team.dataValues); //debug
          res.status(200).json(team.dataValues);
        } else {
          console.log("NO ADMIN");
          res.status(200).json({});
        }          
            
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });


  Router.post('/teams/initialize', passportAuth, (req, res) => {
    const bridgeUser = req.body.email;
    const mnemonic = req.body.mnemonic;

    Service.User.InitializeUser({
      email: bridgeUser,
      mnemonic: mnemonic
      }).then((userData) => {
        // Creating team parent folder
        Service.User.FindUserByEmail(bridgeUser).then((teamUser) => {
          userData.id = teamUser.id;
          userData.email = teamUser.email;
          userData.password = teamUser.password;
          userData.mnemonic = teamUser.mnemonic;
          userData.root_folder_id = teamUser.root_folder_id;

          Service.Folder.Create(
            userData,
            teamUser.name,
            userData.root_folder_id
            
          ).then((folder) => {
            console.log("TEAM FOLDER CREATED: ", folder); //debug
            res.status(200).json({ folder });           
          }).catch((err) => {
            console.log('ERROR CREATING TEAM FOLDER', err);
          });
        }).catch((err) => {
          console.log('ERROR FINDING TEAM USER', err);
        });
      }).catch((err) => {
        Logger.error(`${err.message}\n${err.stack}`);
        res.status(500).send(err.message);
      });

  });


  Router.get('/teams/getById/:id', passportAuth, (req, res) => {
    const { id } = req.params;

    Service.Team.getTeamById(id)
      .then((team) => {
        res.status(200).json(team.dataValues);
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });

  Router.delete('/teams/deleteTeam', passportAuth, (req, res) => {
    const user = req.user;

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

  Router.delete('/teams/deleteMember', passportAuth, (req, res) => {
    const member = req.body.memberEmail;

    Service.Team.deleteMember(member).then(() => {
      res.status(200).send({});
    }).catch((err) => {
      res.status(500).send({});
    });
  });
};
