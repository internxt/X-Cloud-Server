const sgMail = require('@sendgrid/mail');

const { passportAuth } = require('../middleware/passport');

module.exports = (Router, Service, Logger, App) => {
  Router.post('/teams-members', passportAuth, async (req, res) => {
    const { members } = req.body;
    const { user } = req.user;

    let team = await Service.Team.getTeamByMember(user.email);
    if (!team || team.admin !== user.email) {
      res.status(500).send();
    }

    Service.Team.getTeamByIdUser(user)
      .then((team) => {
        if (req.body.idTeam == team.id) {
          const oldMembers = [];

          Service.TeamsMembers.getMembersByIdTeam(team.id)
            .then((teamMembers) => {
              teamMembers.forEach((teamMember) => {
                oldMembers.push(teamMember.user);
              });

              Service.TeamsMembers.save(members, oldMembers, team)
                .then(() => {
                  res.status(200).json({ message: 'new users saved' });
                })
                .catch((err) => {
                  res.status(500).json({ error: err });
                });
            })
            .catch((err) => {
              res.status(500).json({ error: err });
            });
        } else {
          res.status(500).json({ error: "it's not your team" });
        }
      })
      .catch((err) => {
        res.status(500).json({ error: "it's not your team" });
      });
  });

  Router.delete('/teams-members/', passportAuth, (req, res) => {
    const { members } = req.body;
    const { idTeam } = req.body;
    const { user } = req;

    Service.Team.getTeamByIdUser(user.email)
      .then((team) => {
        if (idTeam == team.id) {
          Service.TeamsMembers.remove(members, team.id)
            .then(() => {
              Service.TeamInvitations.remove(members[0])
                .then(() => {
                  res.status(200).json({ message: 'team member removed' });
                })
                .catch((err) => {
                  res.status(500).json({ error: err });
                });
            })
            .catch((err) => {
              res.status(500).json({ error: err });
            });
        } else {
          res.status(500).json({ error: "it's not your team" });
        }
      })
      .catch((err) => {
        res.status(500).json({ error: "it's not your team" });
      });
  });

  Router.get('/teams-members/:user', passportAuth, (req, res) => {
    const userEmail  = req.params.user;

    Service.Team.getTeamByMember(userEmail)
      .then((team) => {        
        console.log("FINDED TEAM", team); //debug
        res.status(200).json(team);        
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });

  Router.get('/teams-members/team/:idTeam', passportAuth, (req, res) => {
    const { idTeam } = req.params;

    Service.TeamsMembers.getMembersByIdTeam(idTeam)
      .then((teamMembers) => {
        res.status(200).json(teamMembers);
      })
      .catch((err) => {
        res.status(500).json(err);
      });
  });
};
