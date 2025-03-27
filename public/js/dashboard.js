import { Chart } from "@/components/ui/chart"
// Dashboard Module
const Dashboard = (() => {
  // Declare Auth and bootstrap
  const Auth = {
    getToken: () => {
      // Replace with your actual token retrieval logic
      return localStorage.getItem("token")
    },
  }

  // DOM Elements
  const statusIndicator = document.getElementById("status-indicator")
  const statusText = document.getElementById("status-text")
  const currentStatus = document.getElementById("current-status")
  const uptimeValue = document.getElementById("uptime-value")
  const lastRestart = document.getElementById("last-restart")
  const incidentsCount = document.getElementById("incidents-count")
  const eventsTableBody = document.getElementById("events-table-body")
  const failureReason = document.getElementById("failure-reason")
  const restartBtn = document.getElementById("restart-btn")
  const confirmRestartBtn = document.getElementById("confirm-restart-btn")
  const refreshBtn = document.getElementById("refresh-btn")
  const systemInfoBtn = document.getElementById("system-info-btn")
  const systemInfoContent = document.getElementById("system-info-content")
  const aboutBtn = document.getElementById("about-btn")
  const mysqlLogs = document.getElementById("mysql-logs")
  const sidebarItems = document.querySelectorAll(".sidebar-menu li")
  const contentPages = document.querySelectorAll(".content-page")
  const sidebarToggle = document.getElementById("sidebar-toggle")
  const sidebar = document.querySelector(".sidebar")
  const mainContent = document.querySelector(".main-content")

  // API Endpoints
  const API_STATUS = "/api/status"
  const API_RESTART = "/api/restart"
  const API_FAILURE_REASON = "/api/failure-reason"
  const API_SYSTEM_INFO = "/api/system-info"

  // Chart
  let statusChart = null

  // Initialize
  function init() {
    initWebSocket()
    attachEventListeners()
    initChart()
    fetchFailureReason()
  }

  // Initialize WebSocket Connection
  function initWebSocket() {
    const token = Auth.getToken()
    if (!token) return

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}?token=${token}`

    window.socket = new WebSocket(wsUrl)

    window.socket.onopen = () => {
      console.log("WebSocket connection established")
    }

    window.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === "status") {
          updateDashboard(data.data)
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error)
      }
    }

    window.socket.onclose = () => {
      console.log("WebSocket connection closed")
      // Try to reconnect after 5 seconds
      setTimeout(initWebSocket, 5000)
    }

    window.socket.onerror = (error) => {
      console.error("WebSocket error:", error)
    }
  }

  // Event Listeners
  function attachEventListeners() {
    restartBtn.addEventListener("click", () => {
      const restartModal = new bootstrap.Modal(document.getElementById("restart-confirm-modal"))
      restartModal.show()
    })

    confirmRestartBtn.addEventListener("click", restartMySQL)
    refreshBtn.addEventListener("click", refreshData)
    systemInfoBtn.addEventListener("click", fetchSystemInfo)
    aboutBtn.addEventListener("click", () => {
      const aboutModal = new bootstrap.Modal(document.getElementById("about-modal"))
      aboutModal.show()
    })

    // Sidebar navigation
    sidebarItems.forEach((item) => {
      item.addEventListener("click", () => {
        const page = item.getAttribute("data-page")
        changePage(page, item)
      })
    })

    // Sidebar toggle
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("sidebar-expanded")
    })
  }

  // Initialize Chart
  function initChart() {
    const ctx = document.getElementById("status-chart").getContext("2d")

    statusChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Database Status",
            data: [],
            backgroundColor: "rgba(67, 97, 238, 0.2)",
            borderColor: "rgba(67, 97, 238, 1)",
            borderWidth: 2,
            pointBackgroundColor: "rgba(67, 97, 238, 1)",
            pointRadius: 4,
            tension: 0.3,
            stepped: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 1,
            ticks: {
              callback: (value) => (value === 0 ? "DOWN" : "UP"),
            },
          },
          x: {
            ticks: {
              maxTicksLimit: 10,
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => (context.raw === 0 ? "Status: DOWN" : "Status: UP"),
            },
          },
        },
      },
    })
  }

  // Update Dashboard with Status Data
  function updateDashboard(data) {
    const { status, history, metrics } = data

    // Update status indicator
    statusIndicator.className = "status-indicator"
    statusIndicator.classList.add(status.toLowerCase())
    statusText.textContent = status

    // Update current status card
    currentStatus.innerHTML = `<span class="status-badge ${status.toLowerCase()}">${status}</span>`

    // Update metrics
    if (metrics) {
      uptimeValue.textContent = `${metrics.uptime.toFixed(2)}%`
      lastRestart.textContent = metrics.lastRestart ? formatDate(new Date(metrics.lastRestart)) : "Never"
      incidentsCount.textContent = metrics.failureCount
    }

    // Update chart and events table if history exists
    if (history && history.length > 0) {
      updateChart(history)
      updateEventsTable(history)
    }
  }

  // Update Chart with History Data
  function updateChart(history) {
    // Prepare data for chart
    const labels = history.map((item) => formatTime(new Date(item.timestamp)))
    const data = history.map((item) => (item.status === "UP" ? 1 : 0))

    // Update chart data
    statusChart.data.labels = labels
    statusChart.data.datasets[0].data = data
    statusChart.update()
  }

  // Update Events Table
  function updateEventsTable(history) {
    // Clear table
    eventsTableBody.innerHTML = ""

    // Sort history by timestamp (newest first)
    const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

    // Add events to table (max 10)
    sortedHistory.slice(0, 10).forEach((item) => {
      const row = document.createElement("tr")

      const timeCell = document.createElement("td")
      timeCell.textContent = formatDate(new Date(item.timestamp))

      const eventCell = document.createElement("td")
      eventCell.textContent = item.status === "UP" ? "Database Up" : "Database Down"

      const statusCell = document.createElement("td")
      const statusBadge = document.createElement("span")
      statusBadge.className = `badge ${item.status === "UP" ? "bg-info" : "bg-danger"}`
      statusBadge.textContent = item.status
      statusCell.appendChild(statusBadge)

      row.appendChild(timeCell)
      row.appendChild(eventCell)
      row.appendChild(statusCell)

      eventsTableBody.appendChild(row)
    })

    // If no events, show message
    if (sortedHistory.length === 0) {
      const row = document.createElement("tr")
      const cell = document.createElement("td")
      cell.colSpan = 3
      cell.className = "text-center"
      cell.textContent = "No events recorded yet"
      row.appendChild(cell)
      eventsTableBody.appendChild(row)
    }
  }

  // Fetch Failure Reason
  async function fetchFailureReason() {
    try {
      const token = Auth.getToken()
      if (!token) return

      const response = await fetch(API_FAILURE_REASON, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch failure reason")
      }

      const data = await response.json()

      if (data.reason) {
        failureReason.innerHTML = `<pre>${data.reason}</pre>`
      } else {
        failureReason.innerHTML = '<p class="text-muted">No failure detected</p>'
      }
    } catch (error) {
      console.error("Error fetching failure reason:", error)
      failureReason.innerHTML = '<p class="text-danger">Error fetching failure reason</p>'
    }
  }

  // Restart MySQL
  async function restartMySQL() {
    try {
      const token = Auth.getToken()
      if (!token) return

      // Close modal
      const modalElement = document.getElementById("restart-confirm-modal")
      const modal = bootstrap.Modal.getInstance(modalElement)

      if (modal) {
        modal.hide()
      } else {
        console.warn("Restart confirmation modal not found.")
      }

      // Show loading state
      restartBtn.disabled = true
      restartBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Restarting...'

      const response = await fetch(API_RESTART, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to restart MySQL")
      }

      const data = await response.json()

      // Show success message
      alert("MySQL restart command issued successfully")
    } catch (error) {
      console.error("Error restarting MySQL:", error)
      alert(`Error restarting MySQL: ${error.message}`)
    } finally {
      // Reset button state
      restartBtn.disabled = false
      restartBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Restart MySQL'
    }
  }

  // Refresh Data
  async function refreshData() {
    try {
      const token = Auth.getToken()
      if (!token) return

      const response = await fetch(API_STATUS, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch status")
      }

      const data = await response.json()
      updateDashboard(data)

      // Also refresh failure reason
      fetchFailureReason()
    } catch (error) {
      console.error("Error refreshing data:", error)
    }
  }

  // Fetch System Info
  async function fetchSystemInfo() {
    try {
      const token = Auth.getToken()
      if (!token) return

      // Show loading state
      systemInfoContent.textContent = "Loading system information..."

      // Show modal
      const modal = new bootstrap.Modal(document.getElementById("system-info-modal"))
      modal.show()

      const response = await fetch(API_SYSTEM_INFO, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch system info")
      }

      const data = await response.json()

      if (data.info) {
        systemInfoContent.textContent = data.info
      } else {
        systemInfoContent.textContent = "No system information available"
      }
    } catch (error) {
      console.error("Error fetching system info:", error)
      systemInfoContent.textContent = `Error: ${error.message}`
    }
  }

  // Change Page
  function changePage(page, item) {
    // Update active sidebar item
    sidebarItems.forEach((i) => i.classList.remove("active"))
    item.classList.add("active")

    // Show selected page, hide others
    contentPages.forEach((p) => {
      if (p.id === `${page}-page`) {
        p.classList.remove("d-none")
      } else {
        p.classList.add("d-none")
      }
    })

    // Load page-specific content
    if (page === "logs") {
      fetchMySQLLogs()
    }
  }

  // Fetch MySQL Logs
  async function fetchMySQLLogs() {
    try {
      const token = Auth.getToken()
      if (!token) return

      mysqlLogs.textContent = "Loading logs..."

      const response = await fetch(API_FAILURE_REASON, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to fetch logs")
      }

      const data = await response.json()

      if (data.reason) {
        mysqlLogs.textContent = data.reason
      } else {
        mysqlLogs.textContent = "No logs available"
      }
    } catch (error) {
      console.error("Error fetching logs:", error)
      mysqlLogs.textContent = `Error: ${error.message}`
    }
  }

  // Helper: Format Date
  function formatDate(date) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date)
  }

  // Helper: Format Time (for chart)
  function formatTime(date) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date)
  }

  // Public API
  return {
    init,
  }
})()

// Make Dashboard available globally
window.Dashboard = Dashboard

