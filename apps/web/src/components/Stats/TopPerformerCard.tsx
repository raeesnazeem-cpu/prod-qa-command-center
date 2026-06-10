import React from "react"
import { Trophy, Star } from "lucide-react"

interface TopPerformerCardProps {
  name: string
  role: string
  genuineCount: number
  avatarUrl?: string
}

const TopPerformerCard: React.FC<TopPerformerCardProps> = ({
  name,
  role,
  genuineCount,
  avatarUrl,
}) => {
  const displayRole = role === "developer" ? "DEVELOPER" : "QA ENGINEER"

  return (
    <div className="bg-accent dark:bg-slate-900 dark:border dark: border-slate-600 text-white dark:text-accent rounded-md p-6 flex items-center justify-between shadow-lg relative overflow-hidden group w-full">
      {/* Background Decorative Icon */}
      <div className="absolute -top-2 -right-2 opacity-10 group-hover:opacity-20 transition-opacity">
        <Trophy size={100} strokeWidth={1} />
      </div>

      <div className="flex items-center gap-5 z-10">
        {/* Avatar Placeholder / Image */}
        <div className="h-16 w-16 rounded-md bg-slate-50 flex items-center justify-center text-black font-black text-2xl border-2 border-white overflow-hidden shadow-inner">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Star size={12} className="text-white fill-white" />
            <span className="text-[10px] font-bold tracking-[0.2em] opacity-60">
              TOP PERFORMER
            </span>
          </div>
          <h3 className="text-2xl font-black tracking-tight leading-none uppercase mb-1">
            {name}
          </h3>
          <p className="text-[10px] font-bold tracking-widest opacity-50">
            {displayRole}
          </p>
        </div>
      </div>

      <div className="text-right z-10 flex flex-col items-end">
        <div className="text-4xl font-black leading-none mb-1">
          {genuineCount}
        </div>
        <div className="text-[10px] font-bold tracking-widest opacity-60 uppercase">
          Genuine Issues
        </div>
      </div>
    </div>
  )
}

export default TopPerformerCard
