// Authentication Module
const Auth = (() => {
  // DOM Elements
  const authContainer = document.getElementById("auth-container")
  const dashboardContainer = document.getElementById("dashboard-container")
  const loginForm = document.getElementById("login-form")
  const registerForm = document.getElementById("register-form")
  const loginError = document.getElementById("login-error")
  const registerError = document.getElementById("register-error")
  const registerSuccess = document.getElementById("register-success")
  const logoutBtn = document.getElementById("logout-btn")
  const userNameElement = document.getElementById("user-name")

  // API Endpoints
  const API_LOGIN = "/api/login"
  const API_REGISTER = "/api/register"

  // Initialize
  function init() {
    attachEventListeners()
    checkAuthentication()
  }

  // Event Listeners
  function attachEventListeners() {
    loginForm.addEventListener("submit", handleLogin)
    registerForm.addEventListener("submit", handleRegister)
    logoutBtn.addEventListener("click", handleLogout)
  }

  // Check if user is already authenticated
  function checkAuthentication() {
    const token = localStorage.getItem("token")
    const user = JSON.parse(localStorage.getItem("user") || "{}")

    if (token) {
      showDashboard(user)
    } else {
      showAuth()
    }
  }

  // Handle Login
  async function handleLogin(e) {
    e.preventDefault()

    const email = document.getElementById("login-email").value
    const password = document.getElementById("login-password").value

    try {
      loginError.classList.add("d-none")

      const response = await fetch(API_LOGIN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Login failed")
      }

      // Save token and user data
      localStorage.setItem("token", data.token)
      localStorage.setItem("user", JSON.stringify(data.user))

      // Show dashboard
      showDashboard(data.user)
    } catch (error) {
      loginError.textContent = error.message
      loginError.classList.remove("d-none")
    }
  }

  // Handle Register
  async function handleRegister(e) {
    e.preventDefault()

    const username = document.getElementById("register-username").value
    const email = document.getElementById("register-email").value
    const password = document.getElementById("register-password").value

    try {
      registerError.classList.add("d-none")
      registerSuccess.classList.add("d-none")

      const response = await fetch(API_REGISTER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Registration failed")
      }

      // Show success message
      registerSuccess.textContent = "Registration successful! You can now login."
      registerSuccess.classList.remove("d-none")

      // Reset form
      registerForm.reset()

      // Switch to login tab after 2 seconds
      setTimeout(() => {
        document.getElementById("login-tab").click()
      }, 2000)
    } catch (error) {
      registerError.textContent = error.message
      registerError.classList.remove("d-none")
    }
  }

  // Handle Logout
  function handleLogout() {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    showAuth()

    // Close WebSocket connection if it exists
    if (window.socket && window.socket.close) {
      window.socket.close()
    }
  }

  // Show Auth Container
  function showAuth() {
    authContainer.classList.remove("d-none")
    dashboardContainer.classList.add("d-none")
  }

  // Show Dashboard
  function showDashboard(user) {
    authContainer.classList.add("d-none")
    dashboardContainer.classList.remove("d-none")

    // Update user name
    if (user && user.username) {
      userNameElement.textContent = user.username
    }

    // Initialize dashboard
    if (window.Dashboard) {
      window.Dashboard.init()
    }
  }

  // Get Auth Token
  function getToken() {
    return localStorage.getItem("token")
  }

  // Public API
  return {
    init,
    getToken,
    showAuth,
  }
})()

// Initialize Auth Module
document.addEventListener("DOMContentLoaded", Auth.init)

