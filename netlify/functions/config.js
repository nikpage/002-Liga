module.exports = {
  neo4j: {
    uri: process.env.NEO4J_URI,
    user: process.env.NEO4J_USER,
    pass: process.env.NEO4J_PASS
  },
  google: {
    key: process.env.GOOGLE_API_KEY,
    embModel: "text-embedding-004"
  }
};
