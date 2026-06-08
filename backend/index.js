const express = require("express");
const cors = require("cors");
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Express backend!" });
});

// Import your database connection
const db = require('./src/models'); // Adjust the path if necessary

// Sync the database
db.sequelize.sync({ alter: true })
    .then(() => {
        console.log("Database tables synced successfully!");
    })
    .catch((err) => {
        console.error("Error syncing database:", err);
    });

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const authRoutes = require('./src/routes/authRoutes');

// This tells Express to use the auth routes
app.use('/api/auth', authRoutes);