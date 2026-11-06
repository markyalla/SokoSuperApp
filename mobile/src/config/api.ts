export const API_DOMAIN = 'api.theagbeko.com';
export const API_BASE_URL = `https://${API_DOMAIN}/api/v1`;
export const WS_BASE_URL = `wss://${API_DOMAIN}/api/v1/ws`;

// Points at the Caddy-fronted domain in front of the Go API (HTTPS, not the
// raw Droplet IP) — required for App Transport Security on iOS, and for
// traffic to be encrypted in transit generally. admin.theagbeko.com is a
// different Caddy site that proxies to the Flask/SokoWeb admin panel, not
// the Go API — do not point mobile at that host.
