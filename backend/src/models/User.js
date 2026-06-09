const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        phoneNumber: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true
            }
        },
        nickname: {
            // Used to keep the survivor semi-anonymous
            type: DataTypes.STRING,
            allowNull: true 
        },
        otpCode: {
            // Temporarily stores the 4-digit code sent via SMS
            type: DataTypes.STRING,
            allowNull: true
        },
        role: {
            // Defines what the user can do in the system
            type: DataTypes.ENUM('survivor', 'counselor', 'legal_counsel', 'admin'),
            defaultValue: 'survivor',
            allowNull: false
        }
    }, {
        tableName: 'Users',
        timestamps: true // Automatically adds createdAt and updatedAt columns
    });

    return User;
};