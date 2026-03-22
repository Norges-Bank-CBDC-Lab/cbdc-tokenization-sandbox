import psycopg2
from psycopg2.extras import RealDictCursor
from scripts import config as c


def get_domain_for_address(address):
    """Returns domain name given an address"""
    connection = _get_db_connection()
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            query = "SELECT domain_name FROM mapping WHERE address = %s;"
            cursor.execute(query, (address,))
            result = cursor.fetchone()
            return result["domain_name"] if result else None
    finally:
        connection.close()


def get_address_for_domain(domain_name):
    """Returns address name given a domain name"""
    connection = _get_db_connection()
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            query = "SELECT address FROM mapping WHERE domain_name = %s;"
            cursor.execute(query, (domain_name,))
            result = cursor.fetchone()
            return result["address"] if result else None
    finally:
        connection.close()


def check_if_exists(address, domain_name):
    """Checks if either name (domain_name) or address exists in the table."""
    connection = _get_db_connection()
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            query = """
                SELECT 1
                FROM mapping
                WHERE domain_name = %s OR address = %s;
            """
            cursor.execute(query, (domain_name, address))
            result = cursor.fetchone()
            return bool(result)
    finally:
        connection.close()


def insert_entry(address, domain_name):
    """Inserts a row into mapping table given address and domain_name"""
    connection = _get_db_connection()
    try:
        with connection.cursor() as cursor:
            query = """
                INSERT INTO mapping (domain_name, address)
                VALUES (%s, %s)
                ON CONFLICT (domain_name) DO NOTHING;
            """
            cursor.execute(query, (domain_name, address))
            connection.commit()
    finally:
        connection.close()


def delete_entry(address, domain_name):
    """Deletes a row from mapping table given address and domain_name"""
    connection = _get_db_connection()
    try:
        with connection.cursor() as cursor:
            query = "DELETE FROM mapping WHERE address = %s AND domain_name = %s;"
            cursor.execute(query, (address, domain_name))
            connection.commit()
    finally:
        connection.close()


def _get_db_connection():
    database_url = c.database_url

    if not database_url:
        raise EnvironmentError("DATABASE_URL environment variable is not set.")
    connection = psycopg2.connect(str(database_url))
    return connection
