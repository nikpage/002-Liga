const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
  }

  const { query } = JSON.parse(event.body || "{}");
  if (!query) return { statusCode: 200, body: JSON.stringify({ persons: [] }) };

  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );

  const session = driver.session();
  try {
    const r = await session.run(
      "MATCH (n:Person) WHERE n.name CONTAINS $q RETURN n LIMIT 10",
      { q: query }
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ persons: r.records.map(x => x.get("n").properties) })
    };
  } finally {
    await session.close();
    await driver.close();
  }
};
