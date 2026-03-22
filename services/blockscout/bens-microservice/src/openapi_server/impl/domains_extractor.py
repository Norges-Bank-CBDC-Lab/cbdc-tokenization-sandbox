from typing import List, Optional

from openapi_server.models.v1_detailed_domain import V1DetailedDomain
from openapi_server.models.v1_get_address_response import V1GetAddressResponse
from openapi_server.models.domains_extractor_batch_resolve_address_names_body import (
    DomainsExtractorBatchResolveAddressNamesBody,
)
from openapi_server.models.v1_batch_resolve_address_names_response import (
    V1BatchResolveAddressNamesResponse,
)
from openapi_server.models.v1_get_protocols_response import V1GetProtocolsResponse
from openapi_server.models.v1_lookup_address_response import V1LookupAddressResponse
from openapi_server.models.v1_lookup_domain_name_response import (
    V1LookupDomainNameResponse,
)
from openapi_server.models.v1_protocol_info import V1ProtocolInfo
from openapi_server.models.v1_domain import V1Domain
from openapi_server.models.v1_address import V1Address
from openapi_server.models.v1_pagination import V1Pagination
from openapi_server.database_utils import get_db_connection

DOCS_URL="https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/tree/development/services/blockscout/bens-microservice"

async def batch_resolve_names(body: DomainsExtractorBatchResolveAddressNamesBody):
    conn = await get_db_connection()
    query = """
    SELECT address, domain_name
    FROM mapping
    WHERE address = ANY($1)
    """
    rows = await conn.fetch(query, body.addresses)
    names = {row["address"]: row["domain_name"] for row in rows}
    return V1BatchResolveAddressNamesResponse(names=names)


async def query_address(address: str):
    conn = await get_db_connection()
    query = """
    SELECT domain_name, COUNT(domain_name) as resolved_domains_count
    FROM mapping
    WHERE address = $1
    GROUP BY domain_name
    """
    row = await conn.fetchrow(query, address)

    if row:
        domain = V1DetailedDomain(name=row["domain_name"])
        response = V1GetAddressResponse(
            domain=domain, resolved_domains_count=row["resolved_domains_count"]
        )
        return response

    return None


async def query_domain(name: str):
    conn = await get_db_connection()
    query = """
    SELECT id, domain_name, address
    FROM mapping
    WHERE domain_name = $1
    """
    row = await conn.fetchrow(query, name)

    if row:
        return V1DetailedDomain(
            id="0x12" + str(row["id"]),
            name=row["domain_name"],
            tokens=[],
            resolved_address={"hash": row["address"]},
            registration_date="",
            other_addresses={},
            protocol={
                "id": "bens",
                "short_name": "BENS",
                "title": "Blockscout Name Service",
                "description": "The Name Service is derived from the microservice Blockscout Name Service (BENS)",
                "deployment_blockscout_base_url": "http://blockscout.cbdc-sandbox.local",
                "tld_list": [],
                "icon_url": "https://i.imgur.com/GOfUwCb.jpeg",
                "docs_url": DOCS_URL,
            },
            stored_offchain=True,
        )

    return None


async def get_protocols():
    items: List[V1ProtocolInfo] = [
        V1ProtocolInfo(
            id="bens",
            short_name="BENS",
            title="Blockscout Name Service",
            description="The Name Service is derived from the microservice Blockscout Name Service (BENS)",
            deployment_blockscout_base_url="http://blockscout.cbdc-sandbox.local",
            tld_list=[],
            icon_url="https://i.imgur.com/GOfUwCb.jpeg",
            docs_url=DOCS_URL,
        )
    ]
    return V1GetProtocolsResponse(items=items)


async def list_domain_events():
    # return empty list containing no events
    return {"items": []}


async def lookup_address(
    address: str = "", page_size: int = 10, page_token: Optional[str] = None
) -> V1LookupAddressResponse:
    conn = await get_db_connection()
    offset = int(page_token) if page_token is not None else 0
    page_size = int(page_size) if page_size is not None else 10
    query = """
    SELECT id, domain_name, address
    FROM mapping
    {}
    LIMIT $1 OFFSET $2
    """.format(
        "WHERE address = $3" if address else ""
    )
    if address:
        rows = await conn.fetch(query, page_size, offset, address)
    else:
        rows = await conn.fetch(query, page_size, offset, address)
    domains = [
        {
            "id": "0x12" + str(row["id"]),
            "name": row["domain_name"],
            "resolved_address": {"hash": row["address"]},
            "registration_date": "",
            "protocol": {
                "id": "bens",
                "short_name": "BENS",
                "title": "Blockscout Name Service",
                "description": "The Name Service is derived from the microservice Blockscout Name Service (BENS)",
                "deployment_blockscout_base_url": "http://blockscout.cbdc-sandbox.local",
                "tld_list": [],
                "icon_url": "https://i.imgur.com/GOfUwCb.jpeg",
                "docs_url": DOCS_URL,
            },
        }
        for row in rows
    ]
    next_page_token = str(offset + page_size) if len(rows) == page_size else None
    return V1LookupAddressResponse(
        items=domains,
        next_page_params=(
            V1Pagination(page_token=next_page_token, page_size=page_size)
            if next_page_token
            else None
        ),
    )


async def lookup_domain_name(
    name: str = "", page_size: int = 10, page_token: Optional[str] = None
) -> V1LookupDomainNameResponse:
    conn = await get_db_connection()
    offset = int(page_token) if page_token is not None else 0
    page_size = int(page_size) if page_size is not None else 50
    query = """
    SELECT id, domain_name, address
    FROM mapping
    {}
    LIMIT $1 OFFSET $2
    """.format(
        "WHERE domain_name LIKE $3" if name else ""
    )
    # Fetch rows with consideration of optional parameters
    if name:
        rows = await conn.fetch(query, page_size, offset, f"%{name}%")
    else:
        rows = await conn.fetch(query, page_size, offset)

    domains: List[V1Domain] = [
        V1Domain(
            id="0x12" + str(row["id"]),
            name=row["domain_name"],
            resolved_address=V1Address(hash=row["address"]),
            registration_date="",
            protocol={
                "id": "bens",
                "short_name": "BENS",
                "title": "Blockscout Name Service",
                "description": "The Name Service is derived from the microservice Blockscout Name Service (BENS)",
                "deployment_blockscout_base_url": "http://blockscout.cbdc-sandbox.local",
                "tld_list": [],
                "icon_url": "https://i.imgur.com/GOfUwCb.jpeg",
                "docs_url": DOCS_URL,
            },
        )
        for row in rows
    ]
    return V1LookupDomainNameResponse(
        items=domains,
        next_page_params=V1Pagination(page_token="100000", page_size=page_size),
    )
