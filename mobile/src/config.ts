// Android emulator reaches the host machine at 10.0.2.2. On a phone, set EXPO_PUBLIC_API_URL
// to http://<your-computer-LAN-IP>:8000 (and run uvicorn with --host 0.0.0.0).
// Any build that talks to a deployed backend must use https.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';
