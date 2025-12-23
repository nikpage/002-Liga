const neo4j = require("neo4j-driver");
const { neo4j: cfg } = require("./config");
const driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.pass));

async function getFullContext(vector, query) {
  const session = driver.session();
  try {
    const vectorRes = await session.run(
      `CALL db.index.vector.queryNodes('chunk_vector_index', 10, $vec) YIELD node MATCH (node)-[:PART_OF]->(d:Document) RETURN collect(DISTINCT { text: node.text, src: d.human_name, url: d.url }) AS chunks`, 
      { vec: vector }
    );
    return {
      chunks: vectorRes.records[0]?.get("chunks") || [],
      insurance: [],
      suppliers: [],
      rentals: []
    };
  } finally { 
    await session.close();
  }
}
module.exports = { getFullContext };
