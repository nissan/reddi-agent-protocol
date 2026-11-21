export type ToastType = "success" | "error" | "info"

export function showToast(msg: string, type: ToastType = "info") {
  if (typeof document === "undefined") return

  const colors = {
    // White text on each passes WCAG AA (4.5:1) in both themes.
    success: "#075e39",
    error: "#b91c1c",
    info: "#14161a",
  } as const

  const t = document.createElement("div")
  t.className = "toast"
  t.setAttribute("role", type === "error" ? "alert" : "status")
  t.style.background = colors[type]
  t.style.color = "white"
  t.textContent = msg
  document.body.appendChild(t)
  window.setTimeout(() => t.remove(), 3200)
}
