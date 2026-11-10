from tests.api.conftest import auth_headers


def register(client, email="r@example.com"):
    r = client.post("/auth/register", json={"email": email, "password": "correct-horse-1"})
    assert r.status_code == 201, r.text
    return r.json()


def test_register_and_login_return_a_refresh_token(client):
    body = register(client, "tok@example.com")
    assert body["refresh_token"]
    login = client.post("/auth/login", json={"email": "tok@example.com", "password": "correct-horse-1"})
    assert login.json()["refresh_token"] and login.json()["refresh_token"] != body["refresh_token"]


def test_refresh_returns_a_working_access_token_and_a_new_refresh_token(client):
    first = register(client)
    r = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r.status_code == 200
    again = r.json()
    assert again["refresh_token"] != first["refresh_token"]
    me = client.get("/me", headers={"Authorization": f"Bearer {again['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "r@example.com"


def test_refresh_with_garbage_is_401(client):
    assert client.post("/auth/refresh", json={"refresh_token": "garbage"}).status_code == 401


def test_logout_then_refresh_is_401(client):
    tokens = register(client)
    assert client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401


def test_logout_with_garbage_is_still_204(client):
    assert client.post("/auth/logout", json={"refresh_token": "garbage"}).status_code == 204


def test_background_token_works_and_logout_of_parent_revokes_it(client):
    tokens = register(client)
    bg = client.post("/auth/background-token", json={"refresh_token": tokens["refresh_token"]})
    assert bg.status_code == 200
    child = bg.json()["refresh_token"]
    assert client.post("/auth/refresh", json={"refresh_token": child}).status_code == 200
    client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert client.post("/auth/refresh", json={"refresh_token": child}).status_code in (401,)


def test_background_token_with_garbage_is_401(client):
    assert client.post("/auth/background-token", json={"refresh_token": "garbage"}).status_code == 401
