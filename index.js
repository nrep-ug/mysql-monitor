/*************************************************************
 * File: index.js
 * Usage: node index.js
 *
 * Description (Extended):
 * 1. Monitors a MySQL database status on a periodic basis.
 * 2. Sends alerts via email when DB is down.
 * 3. Provides protected API routes to:
 *    - GET /status          : Check DB status.
 *    - POST /restart        : Restart the DB.
 *    - GET /failure-reason  : Show last lines of the MySQL error log.
 *
 * 4. Simple user registration & login using a JSON file and JWT.
 *    - POST /register : Create new user
 *    - POST /login    : Login user, get JWT
 *************************************************************/

// ================ 1. Load Dependencies ================
import express from 'express';
import nodemailer from 'nodemailer';
import mysql from 'mysql2/promise';
import { exec } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
// For JWT-based authentication
import jwt from 'jsonwebtoken';

dotenv.config();

// This is the equivalent of __filename
const __filename = fileURLToPath(import.meta.url);
// This is the equivalent of __dirname
const __dirname = path.dirname(__filename);

// ================ 2. Express App Setup ================
const app = express();
app.use(express.json());

// ================ 3. Configurations ================

// MySQL database credentials
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'test',  // or any DB
  port: parseInt(process.env.DB_PORT, 10) || 3306,
};

// Interval to check DB status (in milliseconds)
const CHECK_INTERVAL = 30_000; // 30 seconds

// Email transport configuration
const transporter = nodemailer.createTransport({
  service: 'Gmail', // or configure custom SMTP
  auth: {
    user: process.env.EMAIL_USER || 'your_gmail@gmail.com',
    pass: process.env.EMAIL_PASS || 'your_gmail_password',
  },
});

// Where MySQL error logs are stored
const MYSQL_ERROR_LOG_PATH = process.env.MYSQL_ERROR_LOG_PATH || '/var/log/mysql/error.log';

// Command to restart MySQL (Linux-based systems)
const MYSQL_RESTART_COMMAND = process.env.MYSQL_RESTART_COMMAND || 'sudo service mysql restart';

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY';

// Path to users JSON file (simple credentials storage)
const USERS_FILE_PATH = path.resolve(__dirname, 'users.json');

// ================ 4. Helper Functions ================

/** 
 * Check if MySQL database is up by performing a simple query.
 */
async function isDatabaseUp() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    await connection.query('SELECT 1'); // quick query
    return true;
  } catch (error) {
    console.error('[DB Monitor] Error connecting to DB:', error.message);
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

/** 
 * Send an email alert for DB status changes.
 */
async function sendEmailAlert(subject, message) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER || 'your_gmail@gmail.com',
      to: process.env.ALERT_EMAIL || 'admin@example.com',
      subject: subject,
      text: message,
    });
    console.log('[DB Monitor] Alert email sent:', subject);
  } catch (error) {
    console.error('[DB Monitor] Failed to send email:', error.message);
  }
}

/** 
 * Restart MySQL by calling a system command.
 */
function restartMySQL() {
  return new Promise((resolve, reject) => {
    exec(MYSQL_RESTART_COMMAND, (error, stdout, stderr) => {
      if (error) {
        console.error('[DB Monitor] Restart command error:', stderr);
        return reject(error);
      }
      console.log('[DB Monitor] MySQL restart output:', stdout);
      resolve(stdout);
    });
  });
}

/**
 * Get the possible failure reason from MySQL error log.
 */
function getFailureReason() {
  try {
    const logContent = fs.readFileSync(MYSQL_ERROR_LOG_PATH, 'utf8');
    const lines = logContent.trim().split('\n');
    const lastLines = lines.slice(-10).join('\n');
    return lastLines;
  } catch (err) {
    console.error('[DB Monitor] Unable to read MySQL error log:', err.message);
    return 'Could not read MySQL error log. Check file permissions or path.';
  }
}

/**
 * Read all users from the JSON file.
 * Returns an array of user objects: [{username, email, password}, ...]
 */
function readUsersFromFile() {
  try {
    if (!fs.existsSync(USERS_FILE_PATH)) {
      fs.writeFileSync(USERS_FILE_PATH, JSON.stringify([]), 'utf8');
      return [];
    }
    const data = fs.readFileSync(USERS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[User Auth] Error reading users.json:', err.message);
    return [];
  }
}

/**
 * Write all users to the JSON file.
 */
function writeUsersToFile(users) {
  try {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[User Auth] Error writing to users.json:', err.message);
  }
}

/**
 * Middleware to protect routes. Validates JWT in the "Authorization" header.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  // Typically "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    // Attach user info to request (optional)
    req.user = user;
    next();
  });
}

// ================ 5. Periodic Monitor ================
let lastStatus = true; // assume DB is up at start

async function monitorDatabase() {
  const isUp = await isDatabaseUp();

  // If DB was previously up but now is down => send alert
  if (lastStatus && !isUp) {
    await sendEmailAlert('ALERT: MySQL is DOWN', 'The MySQL database appears to be down.');
  }

  // If DB was previously down but now is up => optionally send a recovery email
  if (!lastStatus && isUp) {
    await sendEmailAlert('RECOVERY: MySQL is UP', 'The MySQL database is back up.');
  }
  

  lastStatus = isUp;
}

// Schedule the periodic check
setInterval(monitorDatabase, CHECK_INTERVAL);

// ================ 6. User Registration & Login Routes ================

/**
 * POST /register
 * Body: { username, email, password }
 * Creates a new user account if email is not already in use.
 */
app.post('/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields: username, email, password are required.' });
  }

  // Read existing users
  const users = readUsersFromFile();
  // Check if email is already in use
  const userExists = users.some(u => u.email === email);
  if (userExists) {
    return res.status(400).json({ error: 'Email already registered.' });
  }

  // Create new user (no hashing used here for simplicity!)
  const newUser = { username, email, password };
  users.push(newUser);
  writeUsersToFile(users);

  res.json({ message: 'User registered successfully.' });
});

/**
 * POST /login
 * Body: { email, password }
 * Logs the user in if credentials match. Returns a JWT.
 */
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const users = readUsersFromFile();
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Generate JWT
  const token = jwt.sign(
    { email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '1h' }  // token expires in 1 hour
  );

  res.json({ message: 'Login successful.', token });
});

// ================ 7. Protected API Routes ================

/**
 * GET /status
 * Returns whether the DB is UP or DOWN.
 * Only accessible to authenticated users (JWT required).
 */
app.get('/status', authenticateToken, async (req, res) => {
  const isUp = await isDatabaseUp();
  res.json({ status: isUp ? 'UP' : 'DOWN' });
});

/**
 * POST /restart
 * Attempts to restart the MySQL database.
 * Only accessible to authenticated users.
 */
app.post('/restart', authenticateToken, async (req, res) => {
  try {
    const output = await restartMySQL();
    res.json({ message: 'MySQL restart command issued.', output });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart MySQL.', details: error.message });
  }
});

/**
 * GET /failure-reason
 * Returns the last lines of the MySQL error log.
 * Only accessible to authenticated users.
 */
app.get('/failure-reason', authenticateToken, (req, res) => {
  const reason = getFailureReason();
  res.json({ reason });
});

// ================ 8. Start the Server ================
const PORT = process.env.PORT || 3006;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DB Monitor] Server running on port ${PORT}...`);
});
