import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRouter from './auth/routes';
import meetingRouter from './meetings/routes';
import workflowRouter from './workflow/routes';
import projectRouter from './projects/routes';
import integrationsRouter from './integrations/routes';

// load .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// MIDDLEWARE
app.use(cors());


// parse incoming json req bodies
app.use(express.json());


// ROUTES
app.use('/api/meetings', meetingRouter);
app.use('/api/workflow-runs', workflowRouter);
app.use('/api/auth', authRouter);
app.use('/api/projects', projectRouter);
app.use('/api/integrations', integrationsRouter);

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