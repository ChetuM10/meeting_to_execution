import dotenv from 'dotenv';
import { extractFromTranscript } from './llm';

dotenv.config();

const SAMPLE_TRANSCRIPT = `
Chetan: Welcome everyone. Let's decide on our database engine for the new microservice.
Vivek: I propose PostgreSQL since we already have team expertise in it and need ACID compliance.
Chetan: Agreed, let's lock in Postgres as our database for the backend.
Sarang: Sounds good. I will set up the initial schema and connection pooling by this Friday.
Vivek: We also need someone to write the JWT auth middleware.
Chetan: Who can take that on? Also, should we support Google OAuth right now or wait for v2?
Vivek: Let's discuss Google OAuth next week.
Sarang: I can take the JWT middleware after I finish the DB setup, maybe early next week.
`;

async function main() {
    console.log('--- Testing Extraction LLM Pipeline ---\n');
    try {
        const result = await extractFromTranscript(SAMPLE_TRANSCRIPT);
        console.log('Extraction Result:\n', JSON.stringify(result, null, 2));

        // Hard Assertions
        console.log('\n--- Running Assertions ---');

        // 1. Must extract at least one decision
        if (result.decisions.length === 0) {
            throw new Error('Assertion Failed: Expected at least 1 decision, got 0.');
        }
        console.log('✅ Decision check passed');

        // 2. Must extract action items
        if (result.action_items.length === 0) {
            throw new Error('Assertion Failed: Expected action items, got 0.');
        }
        console.log('✅ Action items check passed');

        // 3. Must extract open questions
        if (result.open_questions.length === 0) {
            throw new Error('Assertion Failed: Expected at least 1 open question, got 0.');
        }
        console.log('✅ Open questions check passed');

        console.log('\n EXTRACTION TESTS & ASSERTIONS PASSED!');
    } catch (error) {
        console.error('\n Extraction test failed:', error);
        process.exit(1);
    }
}

main();
