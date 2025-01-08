import { NextFunction, Request, RequestHandler, Response } from 'express';
import { auth } from '../config/firebase-admin';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

export const authenticateUser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  auth.verifyIdToken(token)
    .then(decodedToken => {
      (req as AuthRequest).user = {
        uid: decodedToken.uid,
        email: decodedToken.email
      };
      next();
    })
    .catch(error => {
      console.error('Authentication error:', error);
      res.status(401).json({ error: 'Unauthorized - Invalid token' });
    });
}; 