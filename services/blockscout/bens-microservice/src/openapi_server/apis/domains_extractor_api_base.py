# coding: utf-8

from typing import ClassVar, Tuple  # noqa: F401
from typing import Optional

from pydantic import Field, StrictBool, StrictInt, StrictStr
from typing_extensions import Annotated
from openapi_server.models.domains_extractor_batch_resolve_address_names_body import (
    DomainsExtractorBatchResolveAddressNamesBody,
)
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


class BaseDomainsExtractorApi:
    subclasses: ClassVar[Tuple] = ()

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        BaseDomainsExtractorApi.subclasses = BaseDomainsExtractorApi.subclasses + (cls,)

    async def domains_extractor_batch_resolve_address_names(
        self,
        chain_id: Annotated[
            StrictStr,
            Field(description="The chain (network) where domain search should be done"),
        ],
        body: DomainsExtractorBatchResolveAddressNamesBody,
    ) -> V1BatchResolveAddressNamesResponse: ...

    async def domains_extractor_get_address(
        self,
        chain_id: StrictStr,
        address: StrictStr,
        protocol_id: Optional[StrictStr],
    ) -> V1GetAddressResponse: ...

    async def domains_extractor_get_domain(
        self,
        chain_id: Annotated[
            StrictStr,
            Field(description="The chain (network) where domain search should be done"),
        ],
        name: Annotated[
            StrictStr, Field(description="Name of domain, for example vitalik.eth")
        ],
        only_active: Annotated[
            Optional[StrictBool],
            Field(description="Filtering field to remove expired domains"),
        ],
        protocol_id: Annotated[
            Optional[StrictStr],
            Field(
                description="Protocol id of domain, default is first priority protocol on that chain"
            ),
        ],
    ) -> V1DetailedDomain: ...

    async def domains_extractor_get_protocols(
        self,
        chain_id: Annotated[
            StrictStr, Field(description="The chain (network) where to get protocols")
        ],
    ) -> V1GetProtocolsResponse: ...

    async def domains_extractor_list_domain_events(
        self,
        chain_id: Annotated[
            StrictStr,
            Field(description="The chain (network) where domain search should be done"),
        ],
        name: Annotated[
            StrictStr, Field(description="Name of domain, for example vitalik.eth")
        ],
        sort: Annotated[
            Optional[StrictStr],
            Field(description="Sorting field. Default is `timestamp`"),
        ],
        order: Annotated[
            Optional[StrictStr], Field(description="Order direction. Default is DESC")
        ],
        protocol_id: Annotated[
            Optional[StrictStr],
            Field(
                description="Protocol id of domain, default is first priority protocol on that chain"
            ),
        ],
    ) -> V1ListDomainEventsResponse: ...

    async def domains_extractor_lookup_address(
        self,
        chain_id: Annotated[
            StrictStr,
            Field(description="The chain (network) where domain search should be done"),
        ],
        address: Annotated[
            Optional[StrictStr], Field(description="Address of EOA or contract")
        ],
        resolved_to: Annotated[
            Optional[StrictBool],
            Field(description="Include domains resolved to the address"),
        ],
        owned_by: Annotated[
            Optional[StrictBool],
            Field(description="Include domains owned by the address"),
        ],
        only_active: Annotated[
            Optional[StrictBool],
            Field(description="Filtering field to remove expired domains"),
        ],
        sort: Annotated[
            Optional[StrictStr],
            Field(description="Sorting field. Default is `registration_date`"),
        ],
        order: Annotated[
            Optional[StrictStr], Field(description="Order direction. Defaut is DESC")
        ],
        page_size: Annotated[
            Optional[StrictInt],
            Field(
                description="Optional. Max number of items in single response. Default is 50"
            ),
        ],
        page_token: Annotated[
            Optional[StrictStr],
            Field(
                description="Optional. Value of `.pagination.page_token` from previous response"
            ),
        ],
        protocols: Annotated[
            Optional[StrictStr],
            Field(description="comma separated list of protocol ids to filter by"),
        ],
    ) -> V1LookupAddressResponse: ...

    async def domains_extractor_lookup_domain_name(
        self,
        chain_id: Annotated[
            StrictStr,
            Field(description="The chain (network) where domain search should be done"),
        ],
        name: Annotated[
            Optional[StrictStr],
            Field(
                description="Optional. Name of domain, for example vitalik.eth. None means lookup for any name"
            ),
        ],
        only_active: Annotated[
            Optional[StrictBool],
            Field(description="Filtering field to remove expired domains"),
        ],
        sort: Annotated[
            Optional[StrictStr],
            Field(description="Sorting field. Default is `registration_date`"),
        ],
        order: Annotated[
            Optional[StrictStr], Field(description="Order direction. Default is DESC")
        ],
        page_size: Annotated[
            Optional[StrictInt],
            Field(
                description="Optional. Max number of items in single response. Default is 50"
            ),
        ],
        page_token: Annotated[
            Optional[StrictStr],
            Field(
                description="Optional. Value of `.pagination.page_token` from previous response"
            ),
        ],
        protocols: Annotated[
            Optional[StrictStr],
            Field(description="comma separated list of protocol ids to filter by"),
        ],
    ) -> V1LookupDomainNameResponse: ...
