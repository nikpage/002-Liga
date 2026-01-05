const express = require('express');
const cors = require('cors');
const { handler } = require('./netlify/functions/search'); // Uses your existing code

const app = express();
app.use(cors());
app.use(express.json());

app.post('/search', async (req, res) => {
    const event = {
        httpMethod: 'POST',
        body: JSON.stringify(req.body)
    };
    const result = await handler(event);
    res.status(result.statusCode).send(result.body);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
