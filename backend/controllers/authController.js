// backend/controllers/authController.js
const jwt = require('jsonwebtoken');

// Initialize Africa's Talking with your .env credentials
const credentials = {
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME
};
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

// TODO: Import your Sequelize User model here once Karanei defines it
// const { User } = require('../models');

// GENERATE AND SEND OTP
const requestOTP = async (req, res) => {
    const { phoneNumber } = req.body;

    try {
        // Generate a random 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // TODO: Save this OTP to your database tied to this phone number
        // Example: await User.upsert({ phoneNumber: phoneNumber, otpCode: otp });

        // Send the discreet SMS via Africa's Talking
        const options = {
            to: [phoneNumber],
            message: `Your secure access code is: ${otp}. Do not share this code with anyone.`
        };
        
        await sms.send(options);

        res.status(200).json({ message: "OTP sent successfully to your phone." });
    } catch (error) {
        console.error("SMS Sending Error:", error);
        res.status(500).json({ error: "Failed to send OTP. Please try again." });
    }
};

// VERIFY OTP & ISSUE JWT
const verifyOTP = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    try {
        // TODO: Fetch user from DB and check if the OTP matches
        // const user = await User.findOne({ where: { phoneNumber: phoneNumber } });
        // if (!user || user.otpCode !== otp) {
        //     return res.status(401).json({ error: "Invalid or expired OTP" });
        // }

        // If OTP is correct, clear the OTP from the DB for security
        // await user.update({ otpCode: null });

        // Generate a JWT Token to keep them logged in
        // const token = jwt.sign(
        //     { id: user.id, role: user.role }, 
        //     process.env.JWT_SECRET, 
        //     { expiresIn: '2h' } // Token expires in 2 hours for safety
        // );

        // res.status(200).json({ token: token, message: "Login successful!" });
        
        // Temporary success response until DB models are connected:
        res.status(200).json({ message: "OTP verified! (Database logic pending)" });

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ error: "Server error during verification." });
    }
};

module.exports = { requestOTP, verifyOTP };