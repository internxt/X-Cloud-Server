module.exports = (sequelize, DataTypes) => {
  const TeamInvitations = sequelize.define('teamsinvitations', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
      autoIncrement: true
    },
    id_team: DataTypes.INTEGER,
    user: DataTypes.STRING,
    token: DataTypes.STRING,
    bridge_password: DataTypes.STRING,
    mnemonic: DataTypes.STRING
  }, {
    timestamps: false,
    underscored: true
  });

  return TeamInvitations;
};
