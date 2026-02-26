// Vercel Serverless Function — wraps our Express app with error capture
let app;
try {
    app = require('../server');
} catch (err) {
    // If the server fails to load, return the error in the response
    module.exports = (req, res) => {
        res.status(500).json({
            error: 'Server failed to load',
            message: err.message,
            stack: err.stack,
        });
    };
    console.error('SERVER LOAD ERROR:', err);
}

if (app) {
    module.exports = app;
}
