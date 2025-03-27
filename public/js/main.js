// Main JavaScript file
document.addEventListener("DOMContentLoaded", () => {
  // Check for browser notifications permission
  if ("Notification" in window) {
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      document.getElementById("enable-notifications")?.addEventListener("change", (e) => {
        if (e.target.checked) {
          Notification.requestPermission()
        }
      })
    }
  }

  // Settings form
  const settingsForm = document.getElementById("settings-form")
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault()

      // Get form values
      const checkInterval = document.getElementById("check-interval").value
      const alertEmail = document.getElementById("alert-email").value
      const enableNotifications = document.getElementById("enable-notifications").checked

      // Save to localStorage
      localStorage.setItem(
        "settings",
        JSON.stringify({
          checkInterval,
          alertEmail,
          enableNotifications,
        }),
      )

      // Show success message
      alert("Settings saved successfully")
    })

    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem("settings") || "{}")

    if (savedSettings) {
      document.getElementById("check-interval").value = savedSettings.checkInterval || 5000
      document.getElementById("alert-email").value = savedSettings.alertEmail || ""
      document.getElementById("enable-notifications").checked = savedSettings.enableNotifications || false
    }
  }

  // Handle responsive sidebar
  const sidebarToggle = document.getElementById("sidebar-toggle")
  const sidebar = document.querySelector(".sidebar")
  const mainContent = document.querySelector(".main-content")

  if (sidebarToggle && sidebar && mainContent) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("sidebar-expanded")
      mainContent.classList.toggle("main-content-expanded")
    })
  }
})

