import { Role } from '@/store/appStore';

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

const roleConfig: Record<Role, { label: string; classes: string }> = {
  super_admin: {
    label: 'Super Admin',
    classes: 'bg-red-100 text-red-700 border-red-200',
  },
  admin: {
    label: 'Admin',
    classes: 'bg-slate-800 text-white border-slate-900', // navy/dark blue
  },
  sub_admin: {
    label: 'Sub Admin',
    classes: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  project_manager: {
    label: 'Project Manager',
    classes: 'bg-purple-100 text-purple-700 border-purple-200',
  },
  qa_engineer: {
    label: 'QA Engineer',
    classes: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  developer: {
    label: 'Developer',
    classes: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

export const RoleBadge = ({ role, className = '' }: RoleBadgeProps) => {
  const config = roleConfig[role];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  );
};
