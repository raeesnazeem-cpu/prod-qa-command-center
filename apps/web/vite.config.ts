import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Headless mode: no browser auth. Alias Clerk to a no-op shim.
      '@clerk/react': path.resolve(__dirname, './src/lib/clerkShim.tsx'),
    },
  },
  server: {
    allowedHosts: true,
  },
})
