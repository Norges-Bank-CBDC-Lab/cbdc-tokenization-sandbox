import os
import asyncpg

async def get_db_connection():
    database_url = os.getenv('DATABASE_URL')

    if not database_url:
        raise EnvironmentError("DATABASE_URL environment variable is not set.")

    connection = await asyncpg.connect(database_url)
    return connection
