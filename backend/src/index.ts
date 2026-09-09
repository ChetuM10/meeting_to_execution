import express from 'express';
import dotenv from 'dotenv';

import authRouter from './auth/routes';
import projectRouter from './projects/routes';

// load .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// MIDDLEWARE


// parse incoming json req bodies
app.use(express.json());


// ROUTES

app.use('/api/auth', authRouter);
app.use('/api/projects', projectRouter);

// heath
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

// ERROR HANDLER
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export default app;