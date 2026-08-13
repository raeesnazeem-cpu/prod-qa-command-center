import { Request, Response, NextFunction } from "express"

type Role =
  | "super_admin"
  | "admin"
  | "sub_admin"
  | "project_manager"
  | "qa_engineer"
  | "developer"

/**
 * Headless mode: RBAC is TED's responsibility. This is a pass-through that
 * preserves the `requireRole("...")` call signature at every existing call
 * site so nothing needs editing, while never blocking a request.
 */
export const requireRole = (_minimumRole: Role) => {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next()
  }
}
