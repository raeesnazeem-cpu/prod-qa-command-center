import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useAuthAxios } from "@/lib/useAuthAxios"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { useUser } from "@clerk/react"
import { useQueryClient } from "@tanstack/react-query"

const OnboardingSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["developer", "qa_engineer"], {
    required_error: "Please select a role",
  }),
  basecampId: z.string().optional(),
  googleChatId: z.string().optional(),
})

type OnboardingForm = z.infer<typeof OnboardingSchema>

export const OnboardingPage = () => {
  const axios = useAuthAxios()
  const navigate = useNavigate()
  const { user: clerkUser } = useUser()
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingForm>({
    resolver: zodResolver(OnboardingSchema),
    defaultValues: {
      fullName: clerkUser?.fullName || "",
      role: "developer",
      basecampId: "",
      googleChatId: "",
    },
  })

  const onSubmit = async (data: OnboardingForm) => {
    try {
      // Include email from Clerk user if available
      const payload = {
        ...data,
        email:
          clerkUser?.primaryEmailAddress?.emailAddress ||
          clerkUser?.emailAddresses[0]?.emailAddress,
      }
      await axios.post("/api/users/onboard", payload)

      // Invalidate the 'me' query in the background, but don't wait for it
      queryClient.invalidateQueries({ queryKey: ["me"] })

      toast.success("Welcome aboard!")
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      await queryClient.refetchQueries({ queryKey: ["me"] })
      navigate("/dashboard")
    } catch (error: any) {
      toast.error(
        error.response?.data?.error || "Failed to complete onboarding",
      )
    }
  }

  return (
    <div className="min-h-screen bg-[#131d22] flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-[#1d2a31] rounded-md border border-[#1d2a31] shadow-xl p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Complete your profile
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Tell us a bit more about yourself to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Full Name
            </label>
            <input
              {...register("fullName")}
              className={`w-full px-4 h-[44px] rounded-md border bg-[#131d22] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all ${
                errors.fullName
                  ? "border-red-500 bg-red-900/20"
                  : "border-slate-600/50 focus:border-accent"
              }`}
              placeholder="Enter your full name"
            />
            {errors.fullName && (
              <p className="text-xs font-medium text-red-400 mt-1">
                {errors.fullName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Your Role
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="cursor-pointer">
                <input
                  type="radio"
                  value="developer"
                  {...register("role")}
                  className="hidden peer"
                />
                <div className="w-full flex items-center justify-center h-8 rounded-md border border-slate-600/50 bg-[#131d22] text-slate-400 font-bold text-xs uppercase tracking-wider hover:bg-[#131d22]/80 hover:border-slate-500 hover:text-slate-200 transition-all shadow-sm peer-checked:bg-accent peer-checked:text-white peer-checked:border-accent peer-checked:shadow-[0_0_10px_rgba(var(--accent-rgb),0.2)]">
                  Developer
                </div>
              </label>

              <label className="cursor-pointer">
                <input
                  type="radio"
                  value="qa_engineer"
                  {...register("role")}
                  className="hidden peer"
                />
                <div className="w-full flex items-center justify-center h-8 rounded-md border border-slate-600/50 bg-[#131d22] text-slate-400 font-bold text-xs uppercase tracking-wider hover:bg-[#131d22]/80 hover:border-slate-500 hover:text-slate-200 transition-all shadow-sm peer-checked:bg-accent peer-checked:text-white peer-checked:border-accent peer-checked:shadow-[0_0_10px_rgba(var(--accent-rgb),0.2)]">
                  QA
                </div>
              </label>
            </div>
            {errors.role && (
              <p className="text-xs font-medium text-red-400 mt-1">
                {errors.role.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Basecamp ID
              </label>
              <span className="text-xs text-slate-500 font-medium lowercase">
                optional
              </span>
            </div>
            <input
              {...register("basecampId")}
              className="w-full px-4 h-[44px] rounded-md border border-slate-600/50 bg-[#131d22] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              placeholder="e.g. 12345678"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Google Chat ID
              </label>
              <span className="text-xs text-slate-500 font-medium lowercase">
                optional
              </span>
            </div>
            <input
              {...register("googleChatId")}
              className="w-full px-4 h-[44px] rounded-md border border-slate-600/50 bg-[#131d22] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              placeholder="e.g. 1029384756"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-unified w-full h-[38px] rounded-md flex items-center justify-center space-x-2 font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Get Started</span>
                <svg
                  className="w-4 h-4 transform group-hover:translate-x-1 transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
