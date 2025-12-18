import os
from neo4j import GraphDatabase

# REPLACE THESE WITH YOUR AURA CREDENTIALS
URI = "neo4j+s://<YOUR_DB_ID>.databases.neo4j.io"
AUTH = ("neo4j", "<YOUR_PASSWORD>")

def test_connection():
    try:
        with GraphDatabase.driver(URI, auth=AUTH) as driver:
            driver.verify_connectivity()
            print("Connection successful.")
    except Exception as e:
        print(f"Connection Failed: {e}")

if __name__ == "__main__":
    test_connection()
