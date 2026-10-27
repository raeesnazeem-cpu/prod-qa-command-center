import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Sends the qacc_session cookie (TED SSO); web and API are separate origins.
  withCredentials: true,
})

// Interceptor to attach Clerk JWT token
api.interceptors.request.use(
  async (config) => {
    // TODO: Add Clerk JWT token here when integrating with real auth
    // const token = await window.Clerk?.session?.getToken()
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`
    // }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle global API errors here (e.g., redirect to login on 401)
    if (error.response?.status === 401) {
      // Handle unauthorized access
      console.error('Unauthorized access')
    }
    
    if (error.response?.status === 409) {
      console.warn('Conflict Error (409):', error.response?.data?.error || 'Duplicate resource detected.')
      // Add any global toast notification or custom handling for 409 here
    }

    return Promise.reject(error)
  }
)
