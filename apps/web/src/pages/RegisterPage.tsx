import { SignUp } from '@clerk/react'

export const RegisterPage = () => {
  return (
    <div className="min-h-screen bg-bg-main flex flex-col items-center justify-center p-4 font-sans">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">QACC</h1>
        <p className="text-slate-500 mt-2 text-sm uppercase tracking-widest font-medium">QA Command Center</p>
      </div>
      <SignUp
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'shadow-sm border border-slate-200 rounded-md',
            headerTitle: 'text-slate-900 font-bold',
            headerSubtitle: 'text-slate-500',
            socialButtonsBlockButton: 'border-slate-200 hover:bg-slate-50 text-slate-900 rounded-md',
            formButtonPrimary: 'btn-unified w-full !h-[38px] !text-sm',
            footerActionLink: 'text-accent hover:text-accent/80 font-semibold',
            formFieldLabel: 'text-slate-700 font-medium',
            formFieldInput: 'border-slate-200 focus:border-accent focus:ring-accent/20 rounded-md',
          },
        }}
        routing="path"
        path="/register"
        signInUrl="/login"
        fallbackRedirectUrl="/dashboard"
      />
    </div>
  )
}
