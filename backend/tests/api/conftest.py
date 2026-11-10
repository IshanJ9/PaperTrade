import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market.price_source import Quote


class InMemoryQuoteCache:
    """Same interface as QuoteCache; the Redis version is covered in tests/market."""

    def __init__(self) -> None:
        self.data: dict[str, Quote] = {}

    async def put(self, quote: Quote) -> None:
        self.data[quote.symbol] = quote

    async def get_many(self, symbols):
        return {s: self.data[s] for s in symbols if s in self.data}


@pytest.fixture
def cache():
    return InMemoryQuoteCache()


@pytest.fixture
def client(session_factory, cache):
    settings = Settings(jwt_secret="test-secret-test-secret-test-secret-123")
    app = create_app(settings=settings, session_factory=session_factory, quote_cache=cache)
    with TestClient(app) as test_client:
        yield test_client


def auth_headers(client, email="a@example.com", password="correct-horse-1"):
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
