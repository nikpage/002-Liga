const functions = require('@google-cloud/functions-framework'); functions.http('search', (req, res) => { res.send('Search function is active'); });
