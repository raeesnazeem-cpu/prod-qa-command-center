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
    // Fixed, not just default: TED's QACC_URL (see ted/.env) is registered
    // against this exact origin for the SSO return-address check. If this
    // port is already taken, Vite would otherwise silently bump to the next
    // free one (e.g. 5174) and every "Continue with TED" login would then
    // get silently rejected by TED instead of coming back to QACC.
    port: 5173,
    strictPort: true,
  },
})
