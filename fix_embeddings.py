import google.generativeai as genai
from neo4j import GraphDatabase
import time

genai.configure(api_key="AIzaSyAwJBxoXhxlBbBjQyxvwgxz12k6V1hRMHg")
driver = GraphDatabase.driver(
    "neo4j+s://69dc33ec.databases.neo4j.io",
    auth=("neo4j", "sqvJv3o-kdTXz4jxD5mpF5dWI9V_2zeVQqEx6Gw6owM")
)

with driver.session() as session:
    chunks = session.run("MATCH (c:Chunk) RETURN c.text AS text, c.`id:ID` AS id").data()
    
    total = len(chunks)
    print(f"Re-embedding {total} chunks...")
    
    for i, chunk in enumerate(chunks, 1):
        try:
            result = genai.embed_content(
                model="models/embedding-001",
                content=chunk["text"],
                task_type="retrieval_document"
            )
            embedding = result["embedding"]
            
            session.run("""
                MATCH (c:Chunk {`id:ID`: $id})
                SET c.embedding = $embedding
            """, id=chunk["id"], embedding=embedding)
            
            print(f"✓ {i}/{total}: {chunk['id']}")
            time.sleep(0.1)  # Rate limiting
            
        except Exception as e:
            print(f"✗ Failed on {chunk['id']}: {e}")

driver.close()
print("\nDone! Natural language search should work now.")
