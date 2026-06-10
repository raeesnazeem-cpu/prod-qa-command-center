import type { Config } from "tailwindcss"

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#000000",
        accent: "#93C0B1",
        // "bg-main": "#F8F9FA",
        "bg-main": "#F4F6F9",
        // "bg-main": "#1B1D1D",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config
