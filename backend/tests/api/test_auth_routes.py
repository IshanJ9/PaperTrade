from tests.api.conftest import auth_headers


def test_register_returns_a_token_that_works_on_me(client):
    headers = auth_headers(client, "new@example.com")
    me = client.get("/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"


def test_duplicate_email_is_a_conflict(client):
    auth_headers(client, "dup@example.com")
    again = client.post("/auth/register", json={"email": "DUP@example.com", "password": "correct-horse-1"})
    assert again.status_code == 409


def test_short_password_is_rejected(client):
    r = client.post("/auth/register", json={"email": "s@example.com", "password": "short"})
    assert r.status_code == 422


def test_login_success_and_failures(client):
    auth_headers(client, "login@example.com", "correct-horse-1")
    ok = client.post("/auth/login", json={"email": "login@example.com", "password": "correct-horse-1"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    bad_pw = client.post("/auth/login", json={"email": "login@example.com", "password": "nope-nope-1"})
    no_user = client.post("/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-1"})
    assert bad_pw.status_code == 401 and no_user.status_code == 401
    assert bad_pw.json() == no_user.json()


def test_protected_route_needs_a_valid_token(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
