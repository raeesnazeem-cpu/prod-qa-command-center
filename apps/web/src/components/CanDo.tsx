import { ReactNode } from 'react';
import { useRole } from '@/hooks/useRole';
import { Role } from '@/store/appStore';

interface CanDoProps {
  role: Role;
  fallback?: ReactNode;
  children: ReactNode;
}

export const CanDo = ({ role, fallback = null, children }: CanDoProps) => {
  const { canDo, isLoading } = useRole();

  if (isLoading) {
    return null;
  }

  if (!canDo(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
