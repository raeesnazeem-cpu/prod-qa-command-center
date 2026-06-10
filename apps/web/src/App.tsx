import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
// import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from "react-hot-toast"
import { router } from "./routes"
import { queryClient } from "./lib/queryClient"
import { useEffect } from "react"

export const App = () => {
  useEffect(() => {
    const disableAutofill = () => {
      const inputs = document.querySelectorAll("input, textarea, select")
      inputs.forEach((input) => {
        // Set standard off, plus random string fallback for stubborn browsers like Chrome
        input.setAttribute("autocomplete", "new-password")
        input.setAttribute("data-form-type", "other")
      })
    }
    disableAutofill()
    const observer = new MutationObserver(disableAutofill)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" />
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  )
}
