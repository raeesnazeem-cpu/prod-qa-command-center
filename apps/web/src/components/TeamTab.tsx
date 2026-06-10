import { useState, useMemo, useRef, useEffect } from "react"
import { ProjectWithMembers } from "../api/projects.api"
import {
  useAddProjectMember,
  useUpdateProjectMemberRole,
  useWorkspaceUsers,
} from "../hooks/useProjects"
import { UserPlus, Mail, Search } from "lucide-react"
import { CanDo } from "./CanDo"
import toast from "react-hot-toast"

interface TeamTabProps {
  project: ProjectWithMembers
}

export const TeamTab = ({ project }: TeamTabProps) => {
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberRole, setNewMemberRole] = useState<
    "admin" | "sub_admin" | "qa_engineer" | "developer"
  >("developer")
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: allUsers } = useWorkspaceUsers()
  const { mutate: addMember, isPending: isAdding } = useAddProjectMember(
    project.id,
  )
  const { mutate: updateRole } = useUpdateProjectMemberRole(project.id)

  // Filter users based on input and exclude existing members
  const memberEmails = useMemo(
    () =>
      new Set(
        project.project_members
          .map((m) => m.users?.email?.toLowerCase())
          .filter(Boolean),
      ),
    [project.project_members],
  )

  const filteredUsers = useMemo(() => {
    const query = newMemberEmail.toLowerCase().trim()
    if (!query || !allUsers) return []

    return allUsers
      .filter((u) => {
        const email = u.email?.toLowerCase() || ""
        const name = u.full_name?.toLowerCase() || ""
        return (
          !memberEmails.has(email) &&
          (email.includes(query) || name.includes(query))
        )
      })
      .slice(0, 5)
  }, [allUsers, newMemberEmail, memberEmails])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsSearchFocused(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const getInitials = (name: string) => {
    if (!name) return "?"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
      case "super_admin":
        return "bg-[#1E3A5F] text-white" // Navy
      case "qa_engineer":
        return "bg-[#F97316] text-white" // Orange
      case "developer":
        return "bg-slate-400 text-white" // Gray
      default:
        return "bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400"
    }
  }

  const handleUpdateRole = (userId: string, newRole: string) => {
    updateRole({ userId, role: newRole })
  }

  const handleAddMember = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!newMemberEmail) return

    addMember(
      { email: newMemberEmail, role: newMemberRole },
      {
        onSuccess: () => {
          setNewMemberEmail("")
          toast.success("Member added successfully")
        },
        onError: (err: any) => {
          toast.error(err.response?.data?.error || "Failed to add member")
        },
      },
    )
  }

  const selectUser = (user: any) => {
    setNewMemberEmail(user.email)
    setNewMemberRole(user.role as any)
    setIsSearchFocused(false)
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Member List */}
        <div className="flex-grow space-y-4">
          <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-400/50 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-200">
                Project Members
              </h3>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#1d2a31] px-2 py-1 rounded-full">
                {project.project_members.length} Members
              </span>
            </div>
            <div className="divide-y divide-slate-400/50 dark:divide-slate-800">
              {project.project_members.map((member) => (
                <div
                  key={member.user_id}
                  className="px-6 py-4 flex items-center justify-between group hover:bg-slate-50/50 dark:hover:bg-[#1d2a31] transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-[#131d22] flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-sm border border-slate-400/50 dark:border-slate-700">
                      {getInitials(member.users.full_name)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-200">
                        {member.users.full_name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center">
                        <Mail className="w-3 h-3 mr-1" />
                        {member.users.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getRoleBadgeColor(member.role)}`}
                    >
                      {member.role.replace("_", " ")}
                    </span>

                    <CanDo role="qa_engineer">
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleUpdateRole(member.user_id, e.target.value)
                        }
                        className="text-xs border-slate-400/50 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/20 focus:border-accent appearance-none cursor-pointer hover:border-accent transition-all"
                      >
                        <option value="admin">Admin</option>
                        <option value="sub_admin">Sub Admin</option>
                        <option value="qa_engineer">QA Engineer</option>
                        <option value="developer">Developer</option>
                      </select>
                    </CanDo>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add Member Form */}
        <CanDo role="qa_engineer">
          <div className="lg:w-80 shrink-0">
            <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-xl p-6 shadow-sm sticky top-6">
              <div className="flex items-center space-x-2 mb-6">
                <div className="p-2 bg-slate-900 dark:bg-[#131d22] rounded-lg text-white">
                  <UserPlus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-slate-200">
                  Add Member
                </h3>
              </div>

              <form onSubmit={handleAddMember} className="space-y-4">
                <div className="relative" ref={dropdownRef}>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                    <input
                      type="text"
                      value={newMemberEmail}
                      onChange={(e) => {
                        setNewMemberEmail(e.target.value)
                        setIsSearchFocused(true)
                      }}
                      onFocus={() => setIsSearchFocused(true)}
                      placeholder="teammate@example.com"
                      className="w-full bg-slate-50 dark:bg-[#131d22] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent transition-all font-medium"
                      required
                    />
                  </div>

                  {/* Dropdown Suggestions */}
                  {isSearchFocused && filteredUsers.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden animate-in slide-in-from-top-2 duration-200">
                      <div className="p-2 border-b border-slate-400/50 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1d2a31]">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Matching Profiles
                        </span>
                      </div>
                      <div className="divide-y divide-slate-400/50 dark:divide-slate-800">
                        {filteredUsers.map((user) => (
                          <div
                            key={user.id}
                            onClick={() => selectUser(user)}
                            className="p-3 hover:bg-slate-50 dark:hover:bg-[#1d2a31] flex items-center space-x-3 cursor-pointer group transition-colors"
                          >
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#131d22] flex items-center justify-center text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase transition-all group-hover:bg-slate-50 dark:group-hover:bg-[#1d2a31] group-hover:border-accent border border-transparent">
                              {getInitials(user.full_name)}
                            </div>
                            <div className="flex-grow min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-slate-200 truncate uppercase tracking-tight">
                                {user.full_name || "Incomplete Profile"}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                {user.email}
                              </p>
                            </div>
                            <div className="shrink-0">
                              <span className="text-[9px] font-bold uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
                                {user.role}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Assign Role
                  </label>
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as any)}
                    className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition-all font-bold text-slate-900 dark:text-slate-200"
                  >
                    <option value="admin">Admin</option>
                    <option value="sub_admin">Sub Admin</option>
                    <option value="qa_engineer">QA Engineer</option>
                    <option value="developer">Developer</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isAdding}
                  className="btn-unified w-full h-8 uppercase font-bold tracking-widest text-[11px]"
                >
                  {isAdding ? "Adding..." : "Add to Project"}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-slate-400/50 dark:border-slate-700">
                <p className="text-[10px] text-slate-400 leading-relaxed italic font-medium">
                  New members will receive an email notification and immediate
                  access to the project based on their role.
                </p>
              </div>
            </div>
          </div>
        </CanDo>
      </div>
    </div>
  )
}
