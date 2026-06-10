import { Request, Response, NextFunction } from 'express'

type Role = 'super_admin' | 'admin' | 'sub_admin' | 'project_manager' | 'qa_engineer' | 'developer'

const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 6,
  admin: 5,
  sub_admin: 4,
  project_manager: 3,
  qa_engineer: 2,
  developer: 1,
}

export const requireRole = (minimumRole: Role) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.auth?.role as Role | null | undefined

    if (!userRole) {
      res.status(403).json({ error: 'No role found on authenticated user' })
      return
    }

    const userLevel = ROLE_HIERARCHY[userRole]
    const requiredLevel = ROLE_HIERARCHY[minimumRole]

    if (userLevel === undefined) {
      res.status(403).json({ error: `Unknown role: ${userRole}` })
      return
    }

    if (userLevel < requiredLevel) {
      res.status(403).json({
        error: `Insufficient permissions. Required: ${minimumRole}, got: ${userRole}`,
      })
      return
    }

    next()
  }
}
