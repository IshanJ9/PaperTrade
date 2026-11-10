from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health(session_factory):
    app = create_app(settings=Settings(jwt_secret="x" * 40), session_factory=session_factory, quote_cache=object())
    assert TestClient(app).get("/health").json() == {"status": "ok"}
