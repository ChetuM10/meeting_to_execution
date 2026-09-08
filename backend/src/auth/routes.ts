import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { query } from '../db/connection';

const router = Router();

// register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
    const { email, password, full_name } = req.body;

    // 1. input validation
    if (!email || !password) {
        res.status(400).json({ error: 'Email and Password are required.' });
        return;
    }

    if (password.length < 8) {
        res.status(400).json({ error: 'Password must be atleast 8 characters.' });
        return;
    }

    try {
        // 2. check if email is regisgtered
        const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rowCount && existing.rowCount > 0) {
            res.status(409).json({ error: 'An account with this email already exists.' });
            return;
        }

        // 3. hashing
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // 4. new user into DB
        const result = await query(
            `INSERT INTO users(email, password_hash, full_name)
            VALUES ($1, $2, $3)
            RETURNING id, email, full_name, created_at`,
            [email, passwordHash, full_name || null]
        );

        const newUser = result.rows[0];

        // 5. jwt token
        const secret = process.env.JWT_SECRET as string;
        const tokenOptions: jwt.SignOptions = {
            expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
        };
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            secret,
            tokenOptions
        );

        // 6. return user info and token
        res.status(201).json({
            message: 'Account created successfully.',
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                full_name: newUser.full_name,
            },
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// login
router.post('/login', async (req: Request, res: Response):
    Promise<void> => {
    const { email, password } = req.body;

    // input validation
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
    }

    try {
        // find user by email
        const result = await query(
            'SELECT id, email, password_hash, full_name FROM users WHERE email = $1', [email]
        );
        if (!result.rowCount || result.rowCount === 0) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const user = result.rows[0];

        // 3. Compare submitted password against stored hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        // 4. Sign a JWT token
        const secret = process.env.JWT_SECRET as string;
        const tokenOptions: SignOptions = {
            expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
        };
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            secret,
            tokenOptions
        );


        res.status(200).json({
            message: 'Login successful.',
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;