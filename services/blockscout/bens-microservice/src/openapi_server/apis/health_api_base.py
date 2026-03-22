# coding: utf-8

from typing import ClassVar, Tuple  # noqa: F401
from typing import Optional

from pydantic import StrictStr
from openapi_server.models.v1_health_check_response import V1HealthCheckResponse


class BaseHealthApi:
    subclasses: ClassVar[Tuple] = ()

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        BaseHealthApi.subclasses = BaseHealthApi.subclasses + (cls,)

    async def health_check(
        self,
        service: Optional[StrictStr],
    ) -> V1HealthCheckResponse: ...
