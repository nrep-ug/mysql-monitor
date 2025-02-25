import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import mysql from 'mysql2/promise';
import { exec } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import http from 'http';
import * as ws from 'ws'; // Namespace import
import jwt from 'jsonwebtoken';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

console.log('ws:', ws);
console.log('ws.WebSocketServer:', ws.WebSocketServer); // Updated log to verify WebSocketServer
const wss = new ws.WebSocketServer({ server }); // Use ws.WebSocketServer instead of ws.Server

app.use(express.json());
app.use(cors());

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const token = urlParams.get('token');
  if (!token) {
    ws.close();
    return;
  }
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) {
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ status: lastStatus ? 'UP' : 'DOWN' }));
  });
});

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'test',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
};

const CHECK_INTERVAL = 5000;

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your_gmail@gmail.com',
    pass: process.env.EMAIL_PASS || 'your_gmail_password',
  },
});

const MYSQL_ERROR_LOG_PATH = process.env.MYSQL_ERROR_LOG_PATH || '/var/log/mysql/error.log';
const MYSQL_RESTART_COMMAND = process.env.MYSQL_RESTART_COMMAND || 'sudo service mysql restart';
const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY';
const USERS_FILE_PATH = path.resolve(__dirname, 'users.json');

let lastStatus = true;

// Broadcast status to all connected clients
function broadcastStatus(status) {
  wss.clients.forEach((client) => {
    if (client.readyState === ws.WebSocket.OPEN) { // Use ws.WebSocket.OPEN instead of ws.OPEN
      client.send(JSON.stringify({ status }));
    }
  });
}

// Helper Functions (unchanged except for clarity)
async function isDatabaseUp() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    await connection.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[DB Monitor] Error connecting to DB:', error.message);
    return false;
  } finally {
    if (connection) await connection.end();
  }
}

async function sendEmailAlert(subject, message) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER || 'your_gmail@gmail.com',
      to: process.env.ALERT_EMAIL || 'admin@example.com',
      subject,
      text: message,
    });
    console.log('[DB Monitor] Alert email sent:', subject);
  } catch (error) {
    console.error('[DB Monitor] Failed to send email:', error.message);
  }
}

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

function getFailureReason() {
  try {
    const logContent = fs.readFileSync(MYSQL_ERROR_LOG_PATH, 'utf8');
    const lines = logContent.trim().split('\n');
    return lines.slice(-10).join('\n');
  } catch (err) {
    console.error('[DB Monitor] Error reading MySQL error log:', err.message);
    return `Could not read log: ${err.message}`;
  }
}

function readUsersFromFile() {
  if (!fs.existsSync(USERS_FILE_PATH)) {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify([]), 'utf8');
    return [];
  }
  const data = fs.readFileSync(USERS_FILE_PATH, 'utf8');
  return JSON.parse(data);
}

function writeUsersToFile(users) {
  fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf8');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

// Periodic Monitor
async function monitorDatabase() {
  const isUp = await isDatabaseUp();
  if (lastStatus !== isUp) {
    lastStatus = isUp;
    const statusText = isUp ? 'UP' : 'DOWN';
    broadcastStatus(statusText);
    if (!isUp) {
      await sendEmailAlert('ALERT: MySQL is DOWN', 'The MySQL database is down.');
    } else {
      await sendEmailAlert('RECOVERY: MySQL is UP', 'The MySQL database is back up.');
    }
  }
}

setInterval(monitorDatabase, CHECK_INTERVAL);

// User Routes
app.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields.' });
  }
  const users = readUsersFromFile();
  if (users.some(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already registered.' });
  }
  users.push({ username, email, password });
  writeUsersToFile(users);
  res.json({ message: 'User registered successfully.' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }
  const users = readUsersFromFile();
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const token = jwt.sign({ email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ message: 'Login successful.', token });
});

// Protected Routes
app.get('/status', authenticateToken, async (req, res) => {
  const isUp = await isDatabaseUp();
  res.json({ status: isUp ? 'UP' : 'DOWN' });
});

app.post('/restart', authenticateToken, async (req, res) => {
  try {
    const output = await restartMySQL();
    res.json({ message: 'MySQL restart command issued.', output });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart MySQL.', details: error.message });
  }
});

app.get('/failure-reason', authenticateToken, (req, res) => {
  const reason = getFailureReason();
  res.json({ reason });
});

// Start Server
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[DB Monitor] Server running on port ${PORT}...`);
});