import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

export const authenticateToken = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void => {
    // 1 - read the authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // 2 - if no token is present, reject immediately
    if (!token) {
        res.status(401).json({ error: 'Access denied. No tokken provided.' });
        return;
    }

    // 3. verify the token using secret key
    try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET is not configured in environment variables.');
        }
        const decoded = jwt.verify(token, secret) as { userId: string; email: string };

        // 4 - attach the user info decoded to the req obj
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
        };

        // 5 - pass control to the next handler
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or Expired token.' });
    }
};