import { GoogleGenerativeAI } from "@google/generative-ai";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
);
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const handler = async () => {
  const session = driver.session();
  try {
    await session.run("CREATE VECTOR INDEX document_vector_index IF NOT EXISTS FOR (d:Document) ON d.embedding OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}");

    const res = await session.run("MATCH (d:Document) WHERE d.`text:string` IS NOT NULL AND d.embedding IS NULL RETURN id(d) AS id, d.`text:string` AS text");
    const docs = res.records;

    for (const rec of docs) {
      const embedding = await genai.getGenerativeModel({ model: "text-embedding-004" }).embedContent(rec.get("text"));
      await session.run("MATCH (d:Document) WHERE id(d) = $id SET d.embedding = $vec", {
        id: rec.get("id"),
        vec: embedding.embedding.values
      });
      console.log("Embedded", rec.get("id"));
    }
    return { statusCode: 200, body: "DONE – " + docs.length + " nodes embedded" };
  } finally {
    await session.close();
    await driver.close();
  }
};
