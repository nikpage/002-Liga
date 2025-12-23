const neo4j = require("neo4j-driver");
const { neo4j: cfg } = require("./config");
const driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.pass));

async function getFullContext(vector, query) {
  const session = driver.session();
  try {
    const searchTerms = query.split(/\s+/).filter(w => w.length > 2).join(' OR ');
    const [vectorRes, insRes, suppRes, rentRes] = await Promise.all([
      session.run(`CALL db.index.vector.queryNodes('chunk_vector_index', 10, $vec) YIELD node MATCH (node)-[:PART_OF]->(d:Document) RETURN collect(DISTINCT { text: node.text, src: d.human_name, url: d.url }) AS chunks`, { vec: vector }),
      session.run(`CALL db.index.fulltext.queryNodes("insuranceSearch", $term) YIELD node, score RETURN node.search_text as text ORDER BY score DESC LIMIT 3`, { term: searchTerms }),
      session.run(`CALL db.index.fulltext.queryNodes("supplierSearch", $term) YIELD node RETURN node.name + ' (' + node.city + ')' AS text LIMIT 3`, { term: query }),
      session.run(`CALL db.index.fulltext.queryNodes("rentalSearch", $term) YIELD node RETURN node.name + ' (' + node.city + ')' AS text LIMIT 3`, { term: query })
    ]);
    return {
      chunks: vectorRes.records[0]?.get("chunks") || [],
      insurance: insRes.records.map(r => r.get("text")),
      suppliers: suppRes.records.map(r => r.get("text")),
      rentals: rentRes.records.map(r => r.get("text"))
    };
  } finally { await session.close(); }
}
module.exports = { getFullContext };
