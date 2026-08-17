import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { App } from './App'
import './styles/globals.css'
import { captureSsoTokenFromUrl } from './lib/googleAuth'

// TED SSO: if we arrived via https://qacc.raees.dev/sso#token=..., grab and
// store the token BEFORE React renders, so the login gate sees a valid session
// and skips the Google sign-in screen entirely.
captureSsoTokenFromUrl()

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_placeholder'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
)
