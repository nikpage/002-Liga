const express = require('express');
const path = require('path');
const cors = require('cors');
const { search } = require('./search');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// This line fixes the "Cannot GET /" error
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/search', async (req, res) => {
    try {
        const result = await search(req.body);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Search failed' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
