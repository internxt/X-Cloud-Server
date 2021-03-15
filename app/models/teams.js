module.exports = (sequelize, DataTypes) => {
  const Teams = sequelize.define('teams',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true
      },
      admin: DataTypes.STRING,
      name: DataTypes.STRING,
      bridge_user: DataTypes.STRING,
      bridge_password: DataTypes.STRING,
      bridge_mnemonic: DataTypes.STRING,
      total_members: DataTypes.INTEGER
    },
    {
      timestamps: false,
      underscored: true
    });

  return Teams;
};
