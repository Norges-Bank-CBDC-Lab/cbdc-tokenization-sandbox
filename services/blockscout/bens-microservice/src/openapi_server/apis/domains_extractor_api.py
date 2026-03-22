# coding: utf-8
import importlib
import pkgutil
from typing import Optional
from typing_extensions import Annotated

import openapi_server.impl

from fastapi import (  # noqa: F401
    APIRouter,
    Body,
    HTTPException,
    Path,
    Query,
)

from pydantic import Field, StrictBool, StrictStr
from openapi_server.models.domains_extractor_batch_resolve_address_names_body import (
    DomainsExtractorBatchResolveAddressNamesBody,
)
from openapi_server.models.rpc_status import RpcStatus
from openapi_server.models.v1_batch_resolve_address_names_response import (
    V1BatchResolveAddressNamesResponse,
)
from openapi_server.models.v1_detailed_domain import V1DetailedDomain
from openapi_server.models.v1_get_address_response import V1GetAddressResponse
from openapi_server.models.v1_get_protocols_response import V1GetProtocolsResponse
from openapi_server.models.v1_list_domain_events_response import (
    V1ListDomainEventsResponse,
)
from openapi_server.models.v1_lookup_address_response import V1LookupAddressResponse
from openapi_server.models.v1_lookup_domain_name_response import (
    V1LookupDomainNameResponse,
)
from openapi_server.impl.domains_extractor import (
    batch_resolve_names,
    query_address,
    query_domain,
    get_protocols,
    list_domain_events,
    lookup_address,
    lookup_domain_name,
)


router = APIRouter()

ORDER_UNSPECIFIED = "ORDER_UNSPECIFIED"

ns_pkg = openapi_server.impl
for _, name, _ in pkgutil.iter_modules(ns_pkg.__path__, ns_pkg.__name__ + "."):
    importlib.import_module(name)


@router.post(
    "/api/v1/{chain_id}/addresses:batch-resolve-names",
    responses={
        200: {
            "model": V1BatchResolveAddressNamesResponse,
            "description": "A successful response.",
        },
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Perform batch resolving of list of address for blockscout backend requests",
    response_model_by_alias=True,
)
async def domains_extractor_batch_resolve_address_names(
    chain_id: Annotated[
        StrictStr,
        Field(description="The chain (network) where domain search should be done"),
    ] = Path(..., description="The chain (network) where domain search should be done"),
    body: DomainsExtractorBatchResolveAddressNamesBody = Body(None, description=""),
) -> V1BatchResolveAddressNamesResponse:
    response = await batch_resolve_names(body)
    if response is None:
        raise HTTPException(status_code=404, detail="Address not found")
    return response


@router.get(
    "/api/v1/{chain_id}/addresses/{address}",
    responses={
        200: {"model": V1GetAddressResponse, "description": "A successful response."},
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get detailed information about main domain of requested address",
    response_model_by_alias=True,
)
async def domains_extractor_get_address(
    chain_id: StrictStr = Path(..., description=""),
    address: StrictStr = Path(..., description=""),
    protocol_id: Optional[StrictStr] = Query(None, description="", alias="protocol_id"),
) -> V1GetAddressResponse:
    response = await query_address(address)
    if response is None:
        raise HTTPException(status_code=404, detail="Address not found")
    return response


@router.get(
    "/api/v1/{chain_id}/domains/{name}",
    responses={
        200: {"model": V1DetailedDomain, "description": "A successful response."},
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get detailed information about domain for Detailed domain page",
    response_model_by_alias=True,
)
async def domains_extractor_get_domain(
    chain_id: Annotated[
        StrictStr,
        Field(description="The chain (network) where domain search should be done"),
    ] = Path(..., description="The chain (network) where domain search should be done"),
    name: Annotated[
        StrictStr, Field(description="Name of domain, for example vitalik.eth")
    ] = Path(..., description="Name of domain, for example vitalik.eth"),
    only_active: Annotated[
        Optional[StrictBool],
        Field(description="Filtering field to remove expired domains"),
    ] = Query(
        None,
        description="Filtering field to remove expired domains",
        alias="only_active",
    ),
    protocol_id: Annotated[
        Optional[StrictStr],
        Field(
            description="Protocol id of domain, default is first priority protocol on that chain"
        ),
    ] = Query(
        None,
        description="Protocol id of domain, default is first priority protocol on that chain",
        alias="protocol_id",
    ),
) -> V1DetailedDomain:
    response = await query_domain(name)
    if response is None:
        raise HTTPException(status_code=404, detail="Domain not found")
    return response


@router.get(
    "/api/v1/{chain_id}/protocols",
    responses={
        200: {"model": V1GetProtocolsResponse, "description": "A successful response."},
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get list of supported protocols",
    response_model_by_alias=True,
)
async def domains_extractor_get_protocols(
    chain_id: Annotated[
        StrictStr, Field(description="The chain (network) where to get protocols")
    ] = Path(..., description="The chain (network) where to get protocols"),
) -> V1GetProtocolsResponse:
    response = await get_protocols()
    if response is None:
        raise HTTPException(status_code=404, detail="Domain not found")
    return response


@router.get(
    "/api/v1/{chain_id}/domains/{name}/events",
    responses={
        200: {
            "model": V1ListDomainEventsResponse,
            "description": "A successful response.",
        },
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get list of events of domain for Detailed domain page",
    response_model_by_alias=True,
)
async def domains_extractor_list_domain_events(
    chain_id: Annotated[
        StrictStr,
        Field(description="The chain (network) where domain search should be done"),
    ] = Path(..., description="The chain (network) where domain search should be done"),
    name: Annotated[
        StrictStr, Field(description="Name of domain, for example vitalik.eth")
    ] = Path(..., description="Name of domain, for example vitalik.eth"),
    sort: Annotated[
        Optional[StrictStr], Field(description="Sorting field. Default is `timestamp`")
    ] = Query(
        None,
        description="Sorting field. Default is &#x60;timestamp&#x60;",
        alias="sort",
    ),
    order: Annotated[
        Optional[StrictStr], Field(description="Order direction. Default is DESC")
    ] = Query(
        ORDER_UNSPECIFIED, description="Order direction. Default is DESC", alias="order"
    ),
    protocol_id: Annotated[
        Optional[StrictStr],
        Field(
            description="Protocol id of domain, default is first priority protocol on that chain"
        ),
    ] = Query(
        None,
        description="Protocol id of domain, default is first priority protocol on that chain",
        alias="protocol_id",
    ),
) -> V1ListDomainEventsResponse:
    response = await list_domain_events()
    if response is None:
        raise HTTPException(status_code=404, detail="Domain events not found")
    return response


@router.get(
    "/api/v1/{chain_id}/addresses:lookup",
    responses={
        200: {
            "model": V1LookupAddressResponse,
            "description": "A successful response.",
        },
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get basic info about address for ens-lookup and blockscout quick-search. Sorted by &#x60;registration_date&#x60;",
    response_model_by_alias=True,
)
async def domains_extractor_lookup_address(
    chain_id: Annotated[
        StrictStr,
        Field(description="The chain (network) where domain search should be done"),
    ] = Path(..., description="The chain (network) where domain search should be done"),
    address: Annotated[
        Optional[StrictStr], Field(description="Address of EOA or contract")
    ] = Query(None, description="Address of EOA or contract", alias="address"),
    resolved_to: Annotated[
        Optional[bool], Field(description="Include domains resolved to the address")
    ] = Query(
        None, description="Include domains resolved to the address", alias="resolved_to"
    ),
    owned_by: Annotated[
        Optional[bool], Field(description="Include domains owned by the address")
    ] = Query(
        None, description="Include domains owned by the address", alias="owned_by"
    ),
    only_active: Annotated[
        Optional[bool], Field(description="Filtering field to remove expired domains")
    ] = Query(
        None,
        description="Filtering field to remove expired domains",
        alias="only_active",
    ),
    sort: Annotated[
        Optional[StrictStr],
        Field(description="Sorting field. Default is `registration_date`"),
    ] = Query(
        None,
        description="Sorting field. Default is &#x60;registration_date&#x60;",
        alias="sort",
    ),
    order: Annotated[
        Optional[StrictStr], Field(description="Order direction. Defaut is DESC")
    ] = Query(
        ORDER_UNSPECIFIED, description="Order direction. Defaut is DESC", alias="order"
    ),
    page_size: Annotated[
        Optional[int],
        Field(
            description="Optional. Max number of items in single response. Default is 50"
        ),
    ] = Query(
        None,
        description="Optional. Max number of items in single response. Default is 50",
        alias="page_size",
    ),
    page_token: Annotated[
        Optional[StrictStr],
        Field(
            description="Optional. Value of `.pagination.page_token` from previous response"
        ),
    ] = Query(
        None,
        description="Optional. Value of &#x60;.pagination.page_token&#x60; from previous response",
        alias="page_token",
    ),
    protocols: Annotated[
        Optional[StrictStr],
        Field(description="comma separated list of protocol ids to filter by"),
    ] = Query(
        None,
        description="comma separated list of protocol ids to filter by",
        alias="protocols",
    ),
) -> V1LookupAddressResponse:
    response = await lookup_address(address, page_size, page_token)
    if response is None:
        raise HTTPException(status_code=404, detail="Domain not found")
    return response


@router.get(
    "/api/v1/{chain_id}/domains:lookup",
    responses={
        200: {
            "model": V1LookupDomainNameResponse,
            "description": "A successful response.",
        },
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["DomainsExtractor"],
    summary="Get basic info about domain for ens-lookup and blockscout quick-search. Sorted by &#x60;registration_date&#x60;",
    response_model_by_alias=True,
)
async def domains_extractor_lookup_domain_name(
    chain_id: Annotated[
        StrictStr,
        Field(description="The chain (network) where domain search should be done"),
    ] = Path(..., description="The chain (network) where domain search should be done"),
    name: Annotated[
        Optional[StrictStr],
        Field(
            description="Optional. Name of domain, for example vitalik.eth. None means lookup for any name"
        ),
    ] = Query(
        None,
        description="Optional. Name of domain, for example vitalik.eth. None means lookup for any name",
        alias="name",
    ),
    only_active: Annotated[
        Optional[bool], Field(description="Filtering field to remove expired domains")
    ] = Query(
        None,
        description="Filtering field to remove expired domains",
        alias="only_active",
    ),
    sort: Annotated[
        Optional[StrictStr],
        Field(description="Sorting field. Default is `registration_date`"),
    ] = Query(
        None,
        description="Sorting field. Default is &#x60;registration_date&#x60;",
        alias="sort",
    ),
    order: Annotated[
        Optional[StrictStr], Field(description="Order direction. Default is DESC")
    ] = Query(
        ORDER_UNSPECIFIED, description="Order direction. Default is DESC", alias="order"
    ),
    page_size: Annotated[
        Optional[int],
        Field(
            description="Optional. Max number of items in single response. Default is 50"
        ),
    ] = Query(
        None,
        description="Optional. Max number of items in single response. Default is 50",
        alias="page_size",
    ),
    page_token: Annotated[
        Optional[StrictStr],
        Field(
            description="Optional. Value of `.pagination.page_token` from previous response"
        ),
    ] = Query(
        None,
        description="Optional. Value of &#x60;.pagination.page_token&#x60; from previous response",
        alias="page_token",
    ),
    protocols: Annotated[
        Optional[StrictStr],
        Field(description="comma separated list of protocol ids to filter by"),
    ] = Query(
        None,
        description="comma separated list of protocol ids to filter by",
        alias="protocols",
    ),
) -> V1LookupDomainNameResponse:
    response = await lookup_domain_name(name, page_size, page_token)
    if response is None:
        raise HTTPException(status_code=404, detail="Domain not found")
    return response
