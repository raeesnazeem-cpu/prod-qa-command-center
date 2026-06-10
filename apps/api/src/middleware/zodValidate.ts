import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export const zodValidate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      const errors = (result.error as ZodError).errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }))

      res.status(422).json({
        error: 'Validation failed',
        details: errors,
      })
      return
    }

    req.body = result.data
    next()
  }
