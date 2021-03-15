module.exports = (sequelize, DataTypes) => {
  const TeamsMembers = sequelize.define('teamsmembers',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true
      },
      id_team: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      user: {
        type: DataTypes.STRING,
        allowNull: false
      },
      bridge_password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      bridge_mnemonic: {
        type: DataTypes.STRING,
        allowNull: false
      }

    },
    {
      timestamps: false,
      underscored: true
    });

  return TeamsMembers;
};
