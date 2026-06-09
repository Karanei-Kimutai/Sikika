const jwt = require('jsonwebtoken');
const { UserAccount } = require('../models'); // Importing your actual Sequelize model

// Initialize Africa's Talking
const credentials = {
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME
};
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

function isLocalOtpMode() {
    return process.env.SKIP_SMS_IN_DEV === 'true' && process.env.NODE_ENV !== 'production';
}

function getSafeErrorMessage(error) {
    return error.response?.data?.SMSMessageData?.Message ||
        error.response?.data?.message ||
        error.code ||
        error.message ||
        'Unknown error';
}

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
        let [user] = await UserAccount.findOrCreate({
            where: { phoneNumber: phoneNumber },
            defaults: { 
                userRole: 'SURVIVOR',
                role: 'survivor',
                status: 'active'
            } 
        });

        // Save the generated OTP to the database for this specific user
        user.otpHash = otpCode; 
        await user.save();

        let warning = null;

        // Send the OTP via Africa's Talking unless local/dev bypass is enabled.
        if (!isLocalOtpMode()) {
            const options = {
                to: [phoneNumber],
                message: `Your secure access code is: ${otpCode}. Do not share this code with anyone.`
            };

            try {
                await sms.send(options);
            } catch (error) {
                const safeMessage = getSafeErrorMessage(error);
                if (process.env.NODE_ENV === 'production') {
                    throw error;
                }

                warning = `SMS send failed in non-production mode: ${safeMessage}`;
                console.warn("SMS Warning:", warning);
            }
        }

        const response = { message: "OTP generated successfully." };
        if (warning) {
            response.warning = warning;
        }

        // Only expose OTP in explicit local/dev mode for curl/manual QA.
        if (isLocalOtpMode()) {
            response.developmentOtp = otpCode;
        }

        res.status(200).json(response);
    } catch (error) {
        const safeMessage = getSafeErrorMessage(error);
        console.error("SMS Sending Error:", safeMessage);
        res.status(500).json({ error: "Failed to send OTP", details: safeMessage });
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

        // If OTP is correct, clear it and mark phone verification complete.
        user.otpHash = null;
        user.isOtpVerified = true;
        await user.save();

        // Generate a JWT Token to keep them logged in for 2 hours
        const token = jwt.sign(
            { id: user.userId, role: user.role || user.userRole }, 
            process.env.JWT_SECRET,
            { expiresIn: '2h' } 
        );

        // Send the token back to the React frontend
        res.status(200).json({ 
            message: "Login successful!",
            token: token,
            role: user.role || user.userRole
        });

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ error: "Server error during verification." });
    }
};

module.exports = { requestOTP, verifyOTP };
