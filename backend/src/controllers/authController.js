const jwt = require('jsonwebtoken');
const { UserAccount } = require('../models'); // Importing your actual Sequelize model

// Initialize Africa's Talking
const credentials = {
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME
};
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

// GENERATE AND SEND OTP
const requestOTP = async (req, res) => {
    const { phoneNumber } = req.body;

    try {
        if (!phoneNumber) {
            return res.status(400).json({ error: "Phone number is required." });
        }

        // Generate a random 4-digit OTP
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

        // Check if user exists. If not, create a new 'survivor' account
        let [user, created] = await UserAccount.findOrCreate({
            where: { phoneNumber: phoneNumber },
            defaults: { 
                role: 'survivor',
                status: 'active'
            } 
        });

        // Save the generated OTP to the database for this specific user
        user.otpHash = otpCode; 
        await user.save();

        // Send the discreet SMS via Africa's Talking
        const options = {
            to: [phoneNumber],
            message: `Your secure access code is: ${otpCode}. Do not share this code with anyone.`
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
        // Fetch the user from the database
        const user = await UserAccount.findOne({ where: { phoneNumber: phoneNumber } });
        
        // Check if user exists and if the OTP they typed matches the one in the DB
        if (!user || user.otpHash !== otp) {
            return res.status(401).json({ error: "Invalid or expired OTP." });
        }

        // If OTP is correct, clear the OTP from the DB so it can't be used again (Security!)
        user.otpHash = null;
        await user.save();

        // Generate a JWT Token to keep them logged in for 2 hours
        const token = jwt.sign(
            { id: user.id, role: user.role }, 
            process.env.JWT_SECRET || 'fallback_secret_key', 
            { expiresIn: '2h' } 
        );

        // Send the token back to the React frontend
        res.status(200).json({ 
            message: "Login successful!",
            token: token,
            role: user.role
        });

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ error: "Server error during verification." });
    }
};

module.exports = { requestOTP, verifyOTP };