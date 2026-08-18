import type { NextFunction, Request, Response } from 'express';

export function noStoreByDefault(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
