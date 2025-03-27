import express from "express"
import cors from "cors"
import nodemailer from "nodemailer"
import mysql from "mysql2/promise"
import { exec } from "child_process"
import fs from "fs"
import { fileURLToPath } from "url"
import path from "path"
import dotenv from "dotenv"
import http from "http"
import { WebSocketServer } from "ws"
import jwt from "jsonwebtoken"

// Load environment variables
dotenv.config()

// Setup file paths
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration constants
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "test",
  port: Number.parseInt(process.env.DB_PORT, 10) || 3306,
}

const CONFIG = {
  CHECK_INTERVAL: Number.parseInt(process.env.CHECK_INTERVAL, 10) || 5000,
  MYSQL_ERROR_LOG_PATH: process.env.MYSQL_ERROR_LOG_PATH || "/var/log/mysql/error.log",
  MYSQL_RESTART_COMMAND: process.env.MYSQL_RESTART_COMMAND || "sudo service mysql restart",
  JWT_SECRET: process.env.JWT_SECRET || "SUPER_SECRET_KEY",
  USERS_FILE_PATH: path.resolve(__dirname, "users.json"),
  PORT: process.env.PORT || 3006,
  JWT_EXPIRY: process.env.JWT_EXPIRY || "24h",
}

// Initialize Express and HTTP server
const app = express()
const server = http.createServer(app)

// Setup WebSocket server
const wss = new WebSocketServer({ server })

// Configure middleware
app.use(express.json())
app.use(cors())
app.use(express.static(path.join(__dirname, "public")))

// State variables
let lastStatus = true
let statusHistory = []
const serverMetrics = {
  uptime: 0,
  lastRestart: null,
  failureCount: 0,
  successCount: 0,
}

// Email configuration
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER || "your_gmail@gmail.com",
    pass: process.env.EMAIL_PASS || "your_gmail_password",
  },
})

// WebSocket connection handling
wss.on("connection", (ws, req) => {
  console.log("[WebSocket] New connection attempt")

  try {
    const urlParams = new URLSearchParams(req.url.split("?")[1])
    const token = urlParams.get("token")

    if (!token) {
      console.log("[WebSocket] No token provided, closing connection")
      ws.close(1008, "Authentication required")
      return
    }

    jwt.verify(token, CONFIG.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.log("[WebSocket] Invalid token, closing connection")
        ws.close(1008, "Invalid token")
        return
      }

      console.log(`[WebSocket] Authenticated connection for user: ${decoded.username}`)

      // Send initial status
      ws.send(
        JSON.stringify({
          type: "status",
          data: {
            status: lastStatus ? "UP" : "DOWN",
            history: statusHistory.slice(-50),
            metrics: serverMetrics,
          },
        }),
      )

      // Setup ping-pong to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping()
        }
      }, 30000)

      ws.on("close", () => {
        clearInterval(pingInterval)
        console.log("[WebSocket] Connection closed")
      })
    })
  } catch (error) {
    console.error("[WebSocket] Error handling connection:", error)
    ws.close(1011, "Server error")
  }
})

// Helper Functions
async function isDatabaseUp() {
  console.log("[DB Monitor] Checking DB connection...")
  let connection
  try {
    connection = await mysql.createConnection({
      ...DB_CONFIG,
      connectTimeout: 5000, // 5 second timeout
    })
    await connection.query("SELECT 1")
    console.log("[DB Monitor] DB connection successful.")
    return true
  } catch (error) {
    console.error("[DB Monitor] Error connecting to DB:", error.message)
    return false
  } finally {
    if (connection) await connection.end()
  }
}

async function sendEmailAlert(subject, message) {
  if (!process.env.EMAIL_USER || !process.env.ALERT_EMAIL) {
    console.log("[DB Monitor] Email alerts not configured, skipping")
    return
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ALERT_EMAIL,
      subject,
      text: message,
    })
    console.log("[DB Monitor] Alert email sent:", subject)
  } catch (error) {
    console.error("[DB Monitor] Failed to send email:", error.message)
  }
}

function restartMySQL() {
  return new Promise((resolve, reject) => {
    console.log("[DB Monitor] Attempting to restart MySQL...")
    exec(CONFIG.MYSQL_RESTART_COMMAND, (error, stdout, stderr) => {
      if (error) {
        console.error("[DB Monitor] Restart command error:", stderr)
        return reject(error)
      }
      console.log("[DB Monitor] MySQL restart output:", stdout)
      serverMetrics.lastRestart = new Date().toISOString()
      resolve(stdout)
    })
  })
}

function getFailureReason() {
  try {
    if (!fs.existsSync(CONFIG.MYSQL_ERROR_LOG_PATH)) {
      return "MySQL error log file not found"
    }

    const logContent = fs.readFileSync(CONFIG.MYSQL_ERROR_LOG_PATH, "utf8")
    const lines = logContent.trim().split("\n")
    return lines.slice(-10).join("\n")
  } catch (err) {
    console.error("[DB Monitor] Error reading MySQL error log:", err.message)
    return `Could not read log: ${err.message}`
  }
}

function readUsersFromFile() {
  try {
    if (!fs.existsSync(CONFIG.USERS_FILE_PATH)) {
      fs.writeFileSync(CONFIG.USERS_FILE_PATH, JSON.stringify([]), "utf8")
      return []
    }
    const data = fs.readFileSync(CONFIG.USERS_FILE_PATH, "utf8")
    return JSON.parse(data)
  } catch (error) {
    console.error("[DB Monitor] Error reading users file:", error)
    return []
  }
}

function writeUsersToFile(users) {
  try {
    fs.writeFileSync(CONFIG.USERS_FILE_PATH, JSON.stringify(users, null, 2), "utf8")
  } catch (error) {
    console.error("[DB Monitor] Error writing users file:", error)
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "No token provided." })
  }

  jwt.verify(token, CONFIG.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token." })
    }
    req.user = user
    next()
  })
}

// Broadcast status to all connected clients
function broadcastStatus(status) {
  console.log("[DB Monitor] Broadcasting status:", status)

  // Add to history
  statusHistory.push({
    timestamp: new Date().toISOString(),
    status: status,
  })

  // Keep history at a reasonable size
  if (statusHistory.length > 1000) {
    statusHistory = statusHistory.slice(-1000)
  }

  // Update metrics
  if (status === "UP") {
    serverMetrics.successCount++
  } else {
    serverMetrics.failureCount++
  }

  // Calculate uptime percentage
  const total = serverMetrics.successCount + serverMetrics.failureCount
  serverMetrics.uptime = total > 0 ? (serverMetrics.successCount / total) * 100 : 100

  // Broadcast to all clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocketServer.OPEN) {
      client.send(
        JSON.stringify({
          type: "status",
          data: {
            status,
            history: statusHistory.slice(-50),
            metrics: serverMetrics,
          },
        }),
      )
    }
  })
}

// Periodic Monitor
async function monitorDatabase() {
  try {
    const isUp = await isDatabaseUp()

    if (lastStatus !== isUp) {
      lastStatus = isUp
      const statusText = isUp ? "UP" : "DOWN"

      broadcastStatus(statusText)

      if (!isUp) {
        await sendEmailAlert(
          "ALERT: MySQL is DOWN",
          `The MySQL database is down.\nTimestamp: ${new Date().toISOString()}\nServer: ${DB_CONFIG.host}`,
        )
      } else {
        await sendEmailAlert(
          "RECOVERY: MySQL is UP",
          `The MySQL database is back up.\nTimestamp: ${new Date().toISOString()}\nServer: ${DB_CONFIG.host}`,
        )
      }
    }
  } catch (error) {
    console.error("[DB Monitor] Error in monitoring cycle:", error)
  }
}

// Start monitoring
const monitorInterval = setInterval(monitorDatabase, CONFIG.CHECK_INTERVAL)

// Graceful shutdown
process.on("SIGINT", () => {
  clearInterval(monitorInterval)
  server.close(() => {
    console.log("[DB Monitor] Server shut down gracefully")
    process.exit(0)
  })
})

// User Routes
app.post("/api/register", (req, res) => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." })
    }

    const users = readUsersFromFile()

    if (users.some((u) => u.email === email)) {
      return res.status(400).json({ error: "Email already registered." })
    }

    users.push({
      id: Date.now().toString(),
      username,
      email,
      password, // In a production app, you should hash this password
      createdAt: new Date().toISOString(),
    })

    writeUsersToFile(users)
    res.json({ message: "User registered successfully." })
  } catch (error) {
    console.error("[DB Monitor] Registration error:", error)
    res.status(500).json({ error: "Server error during registration." })
  }
})

app.post("/api/login", (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required." })
    }

    const users = readUsersFromFile()
    const user = users.find((u) => u.email === email && u.password === password)

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." })
    }

    const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, CONFIG.JWT_SECRET, {
      expiresIn: CONFIG.JWT_EXPIRY,
    })

    res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    })
  } catch (error) {
    console.error("[DB Monitor] Login error:", error)
    res.status(500).json({ error: "Server error during login." })
  }
})

// Protected Routes
app.get("/api/status", authenticateToken, async (req, res) => {
  try {
    const isUp = await isDatabaseUp()
    res.json({
      status: isUp ? "UP" : "DOWN",
      history: statusHistory.slice(-50),
      metrics: serverMetrics,
    })
  } catch (error) {
    res.status(500).json({ error: "Failed to check database status." })
  }
})

app.post("/api/restart", authenticateToken, async (req, res) => {
  try {
    const output = await restartMySQL()
    res.json({ message: "MySQL restart command issued.", output })
  } catch (error) {
    res.status(500).json({ error: "Failed to restart MySQL.", details: error.message })
  }
})

app.get("/api/failure-reason", authenticateToken, (req, res) => {
  try {
    const reason = getFailureReason()
    res.json({ reason })
  } catch (error) {
    res.status(500).json({ error: "Failed to get failure reason." })
  }
})

// System information route
app.get("/api/system-info", authenticateToken, (req, res) => {
  try {
    exec("uptime && free -m && df -h", (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ error: "Failed to get system info.", details: stderr })
      }
      res.json({ info: stdout })
    })
  } catch (error) {
    res.status(500).json({ error: "Failed to get system info." })
  }
})

// Start Server
server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`[DB Monitor] Server running on port ${CONFIG.PORT}...`)
  console.log(`[DB Monitor] Monitoring MySQL at ${DB_CONFIG.host}:${DB_CONFIG.port}`)
})

export default app

