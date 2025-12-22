const functions = require('@google-cloud/functions-framework');
const neo4j = require('neo4j-driver');

functions.http('search', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    
    // Health check - respond immediately
    if (req.path === '/' && req.method === 'GET') {
        return res.status(200).send('OK');
    }
    
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    try {
        const driver = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
        );

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
        console.error('ERROR:', error);
        res.status(500).send({
            error: 'Search failed',
            details: error.message
        });
    }
});
