const functions = require('@google-cloud/functions-framework');
const neo4j = require('neo4j-driver');
const { google } = require('googleapis');

functions.http('search', async (req, res) => {
    // Enable CORS immediately so the health check passes
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    // Wrap ALL logic in try/catch to prevent the container from dying
    try {
        // 1. Initialize Neo4j INSIDE the function handler
        const driver = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
        );

        // 2. Initialize Google Auth INSIDE
        const auth = new google.auth.GoogleAuth({
            keyFilename: 'service-account-key.json',
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });

        const { query } = req.body || {};
        if (!query) {
            return res.status(400).send({ error: 'Query is required' });
        }

        const session = driver.session();
        try {
            const result = await session.run(
                'MATCH (n:Person) WHERE n.name CONTAINS $query RETURN n LIMIT 10',
                { query }
            );
            const persons = result.records.map(record => record.get('n').properties);
            res.status(200).send({ persons });
        } finally {
            await session.close();
            await driver.close();
        }

    } catch (error) {
        // Log the exact error to Cloud Logging instead of crashing the server
        console.error('SYSTEM ERROR:', error);
        res.status(500).send({
            error: 'Initialization failed',
            details: error.message
        });
    }
});
