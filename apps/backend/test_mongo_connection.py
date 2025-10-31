"""
test_mongo_connection.py

Purpose:
- Load .env.local
- Connect to MongoDB using pymongo
- Ping the server
- List all databases and collections
"""

from dotenv import load_dotenv
from pymongo import MongoClient
import os
import sys

def main():
    # Load environment
    env_path = ".env.local"
    if not load_dotenv(env_path):
        print(f"⚠️  Could not load {env_path}. Check if file exists.")
        sys.exit(1)

    # Get Mongo URI and DB
    uri = os.getenv("MONGODB_URI")
    db_name = os.getenv("MONGODB_DB", "kydohub")

    if not uri:
        print("❌ MONGODB_URI not found in environment. Please check your .env.local file.")
        sys.exit(1)

    print(f"🔗 Connecting to MongoDB: {uri}")
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Ping the server
        client.admin.command("ping")
        print("✅ Connection successful!")

        # List databases
        print("\n📦 Databases:")
        for db_name_in_cluster in client.list_database_names():
            print(f"  - {db_name_in_cluster}")

        # Access specific DB
        db = client[db_name]
        print(f"\n📂 Collections in '{db_name}':")
        for coll_name in db.list_collection_names():
            print(f"  - {coll_name}")

        if not db.list_collection_names():
            print("  (No collections found yet)")

    except Exception as e:
        print("❌ MongoDB connection failed:")
        print(e)

if __name__ == "__main__":
    main()
