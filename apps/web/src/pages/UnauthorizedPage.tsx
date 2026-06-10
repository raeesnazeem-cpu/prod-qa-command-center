import { useNavigate } from "react-router-dom"
import { useRole } from "@/hooks/useRole"
import { RoleBadge } from "@/components/RoleBadge"
import { ShieldAlert, ArrowLeft } from "lucide-react"

export const UnauthorizedPage = () => {
  const navigate = useNavigate()
  const { role } = useRole()

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8 animate-in fade-in zoom-in duration-300">
        <div className="flex justify-center">
          <div className="p-4 bg-red-50 rounded-md border border-red-100 shadow-sm">
            <ShieldAlert className="w-12 h-12 text-red-600" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
            403
          </h1>
          <h2 className="text-xl font-bold text-slate-800">Access Denied</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            You don't have the required permissions to access this page. Please
            contact your administrator if you believe this is an error.
          </p>
        </div>

        {role && (
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Your Current Role
            </p>
            <RoleBadge role={role} />
          </div>
        )}

        <button
          onClick={() => navigate(-1)}
          className="btn-unified flex items-center space-x-2 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Go Back</span>
        </button>
      </div>
    </div>
  )
}
