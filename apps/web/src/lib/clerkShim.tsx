/**
 * Headless mode: QACC no longer authenticates in the browser — TED owns auth.
 * This shim is aliased over "@clerk/react" in vite.config so every existing
 * import keeps working without editing 75 files. All hooks report a signed-in
 * synthetic "system" user; visual components render nothing.
 */
import React from "react"

const SYSTEM_USER = {
  id: "system",
  fullName: "System",
  firstName: "System",
  lastName: "",
  primaryEmailAddress: { emailAddress: "system@qacc.internal" },
  emailAddresses: [{ emailAddress: "system@qacc.internal" }],
  imageUrl: "",
}

export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: true,
  userId: "system",
  sessionId: "system",
  orgId: null,
  orgRole: "super_admin",
  getToken: async () => null,
  signOut: async () => {},
})

export const useUser = () => ({
  isLoaded: true,
  isSignedIn: true,
  user: SYSTEM_USER,
})

export const useClerk = () => ({
  signOut: async () => {},
  openSignIn: () => {},
  openSignUp: () => {},
})

export const ClerkProvider = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
)

export const UserButton = () => null
export const SignIn = () => null
export const SignUp = () => null
export const AuthenticateWithRedirectCallback = () => null

export const SignOutButton = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
)
