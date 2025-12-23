async function getFullContext(vector, query) {
  const session = driver.session();
  try {
    const vectorRes = await session.run(
      `CALL db.index.vector.queryNodes('chunk_vector_index', 15, $vec)
       YIELD node, score
       MATCH (node)-[:PART_OF]->(d:Document)
       RETURN node.text AS text, d.human_name AS title, d.url AS url, score
       ORDER BY score DESC`,
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
