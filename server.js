require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const { search } = require('./search');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serves the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handles the search request from the frontend
app.post('/search', async (req, res) => {
    try {
        const result = await search(req.body);
        res.json(result);
    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: 'Search failed' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
