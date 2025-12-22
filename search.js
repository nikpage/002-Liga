const functions = require("@google-cloud/functions-framework");

functions.http("search", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  if (req.method === "OPTIONS") return res.status(204).end();
  res.json({ ok: true });
});
