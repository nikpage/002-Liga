const neo4j = require("neo4j-driver");
const { neo4j: cfg } = require("./config");
const driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.pass));

async function getFullContext(vector, query) {
  const session = driver.session();
  try {
    const vectorRes = await session.run(
      `CALL db.index.vector.queryNodes('chunk_vector_index', 15, $vec)
       YIELD node
       MATCH (node)-[:PART_OF]->(d:Document)
       RETURN node.text AS text, d.human_name AS title, d.url AS url`,
      { vec: vector }
    );

    const chunks = vectorRes.records.map(r => ({
      text: r.get("text"),
      title: r.get("title"),
      url: r.get("url")
    }));

    return { chunks };
  } finally {
    await session.close();
  }
}
module.exports = { getFullContext };
