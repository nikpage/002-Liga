import os
import google.generativeai as genai
from neo4j import GraphDatabase

# Auth
URI = "neo4j+s://69dc33ec.databases.neo4j.io"
AUTH = ("neo4j", "sqvJv3o-kdTXz4jxD5mpF5dWI9V_2zeVQqEx6Gw6owM")

# Config
genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

def load_vectors(driver):
    with driver.session() as session:
        # 1. Setup Index (768 dims for Gemini 004)
        print("Resetting Index...")
        session.run("DROP INDEX document_vector_index IF EXISTS")
        session.run("CREATE VECTOR INDEX document_vector_index IF NOT EXISTS FOR (d:Document) ON (d.embedding) OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}")

        # 2. Fetch Text
        # Note: Using backticks `text:string` as required
        records = session.run("MATCH (d:Document) WHERE d.`text:string` IS NOT NULL RETURN ID(d) as id, d.`text:string` as text").data()
        print(f"Found {len(records)} documents.")

        # 3. Embed & Save
        for row in records:
            try:
                # Embedding model
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=row['text']
                )
                
                # Update Node
                session.run(
                    "MATCH (d:Document) WHERE ID(d) = $id SET d.embedding = $vec",
                    id=row['id'], vec=result['embedding']
                )
                print(f"Saved Node {row['id']}")
            except Exception as e:
                print(f"Error on Node {row['id']}: {e}")

if __name__ == "__main__":
    with GraphDatabase.driver(URI, auth=AUTH) as driver:
        load_vectors(driver)
