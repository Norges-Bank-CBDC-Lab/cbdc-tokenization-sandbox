# coding: utf-8
import importlib
import pkgutil
from typing import Optional

import openapi_server.impl

from fastapi import (  # noqa: F401
    APIRouter,
    Query,
)

from pydantic import StrictStr
from openapi_server.models.rpc_status import RpcStatus
from openapi_server.models.v1_health_check_response import V1HealthCheckResponse
from openapi_server.models.health_check_response_serving_status import (
    HealthCheckResponseServingStatus,
)


router = APIRouter()

ns_pkg = openapi_server.impl
for _, name, _ in pkgutil.iter_modules(ns_pkg.__path__, ns_pkg.__name__ + "."):
    importlib.import_module(name)


@router.get(
    "/health",
    responses={
        200: {"model": V1HealthCheckResponse, "description": "A successful response."},
        "default": {"model": RpcStatus, "description": "An unexpected error response."},
    },
    tags=["Health"],
    summary="If the requested service is unknown, the call will fail with status NOT_FOUND.",
    response_model_by_alias=True,
)
async def health_check(
    service: Optional[StrictStr] = Query(None, description="", alias="service"),
) -> V1HealthCheckResponse:
    status = HealthCheckResponseServingStatus.SERVING
    return V1HealthCheckResponse(status=status)
