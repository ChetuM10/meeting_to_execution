import { Pool, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'meeting_copilot',
    max: 20, //max active clients in a pool
    idleTimeoutMillis: 30000, //close idle clients after 30 secs
    connectionTimeoutMillis: 2000, //if conn cannot be established, return error in 2 secs
});

// catch errors to prevent backend crash
pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
    process.exit(-1);
});

export const query = async<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
): Promise<QueryResult<T>> => {
    const start = Date.now();
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
        console.log('Executed query', {
            text: text.trim().substring(0, 80),
            duration: `${duration}ms`, rows: res.rowCount
        });
    }
    return res;
};
export default pool;