import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pool from '../db/connection';

export const checkpointer = new PostgresSaver(pool);

// initialize checkpoint db tables
export async function initCheckpointer(): Promise<void> {
    try {
        await checkpointer.setup();
        console.log('PostgresSaver checkpointer tables verified/created successfully.');
    } catch (err: any) {
        console.error('Failed to initialize PostgresSaver checkpointer:', err.message);
        throw err;
    }
}