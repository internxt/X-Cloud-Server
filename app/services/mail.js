const InternxtMailer = require('storj-service-mailer');

module.exports = (Model, App) => {
  const mailInstance = () => new InternxtMailer({
    host: process.env.STORJ_MAILER_HOST,
    port: process.env.STORJ_MAILER_PORT,
    secure:
        process.env.NODE_ENV === 'staging'
        || process.env.NODE_ENV === 'production',
    auth: {
      user: process.env.STORJ_MAILER_USERNAME,
      pass: process.env.STORJ_MAILER_PASSWORD
    },
    from: 'hello@internxt.com'
  });

  const sendInvitationMail = (emailTo, user) => {
    const mailer = mailInstance();

    return new Promise((resolve, reject) => {
      mailer.dispatch(
        emailTo,
        'referral',
        {
          template: 'referral',
          go: { in: 'here' },
          senderUser: user.name,
          url: `https://internxt.com/?ref=${user.uuid}`
        },
        (err) => {
          if (!err) {
            console.log(`Mail sent to ${emailTo}!`);
            resolve();
          } else {
            console.error(`Error sending mail to ${emailTo}`);
            console.error(err);
            reject(err);
          }
        }
      );
    });
  };

  const sendEmailTeamsMember = (member, cryptedToken, teamName) => {
    const mailer = new InternxtMailer({
        host: process.env.STORJ_MAILER_HOST,
        port: process.env.STORJ_MAILER_PORT,
        secure: process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production',
        auth: {
          user: process.env.STORJ_MAILER_USERNAME,
          pass: process.env.STORJ_MAILER_PASSWORD,
        },
        from: 'hello@internxt.com',
    });

    return new Promise((resolve, reject) => {
      mailer.dispatch(
        member, 
        'join-team', 
        {
          template: 'join-team',
          go: { in: 'here' },
          memberName: member.user,
          teamName: teamName,
          urlAcceptInvitation: `${process.env.HOST_DRIVE_WEB}/teams/join/${cryptedToken}`
          
        }, (err) => {   
        if (!err) {
          console.log(member);
          resolve(`Mail team's invitation send to ${member}!`);
          Logger.info("Teams: Team invitation mail sent to", member);
          console.log(member);
        } else {
          reject(`Error sending mail team's invitation to ${member}`);
        }
      });
    });
  }

  return {
    Name: 'Mail',
    sendInvitationMail,
    sendEmailTeamsMember
  };
};
