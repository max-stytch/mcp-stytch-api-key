import {WeatherAppMCP} from "./WeatherAppMCP.ts";
import {
    getStytchOAuthEndpointUrl,
    stytchBearerTokenAuthMiddleware,
    stytchSessionAuthMiddleware
} from "./lib/auth";
import {cors} from "hono/cors";
import {Hono} from "hono";
import {decryptSecret, encryptSecret} from "./lib/keys.ts";

// Export the WeatherAppMCP class so the Worker runtime can find it
export {WeatherAppMCP};

const SecretManagementAPI = new Hono<{ Bindings: Env }>()
    .get('/apikey', stytchSessionAuthMiddleware, async (c) => {
        const encryptedAPIKey = await c.env.API_KEYS.get(c.get('userID'))
        if (!encryptedAPIKey) return c.json({apiKey: null});

        const decryptedAPIKey = await decryptSecret(c.env, encryptedAPIKey);
        return c.json({apiKey: decryptedAPIKey});
    })

    .post('/apikey', stytchSessionAuthMiddleware, async (c) => {
        const {apiKey} = await c.req.json();
        if (apiKey === null || apiKey === "") {
            await c.env.API_KEYS.delete(c.get('userID'));
        } else {
            const encryptedAPIKey = await encryptSecret(c.env, apiKey);
            await c.env.API_KEYS.put(c.get('userID'), encryptedAPIKey);
        }
        return c.json({success: true});
    })

export type App = typeof SecretManagementAPI;

export default new Hono<{ Bindings: Env }>()
    .use(cors())

    // Mount the Secret Management API underneath us
    .route('/api', SecretManagementAPI)

    // Serve the OAuth Authorization Server response for Dynamic Client Registration
    .get('/.well-known/oauth-authorization-server', async (c) => {
        const url = new URL(c.req.url);
        return c.json({
            issuer: c.env.STYTCH_PROJECT_ID,
            // Link to the OAuth Authorization screen implemented within the React UI
            authorization_endpoint: `${url.origin}/oauth/authorize`,
            token_endpoint: getStytchOAuthEndpointUrl(c.env, 'oauth2/token'),
            registration_endpoint: getStytchOAuthEndpointUrl(c.env, 'oauth2/register'),
            scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
        })
    })

    // Let the MCP Server have a go at handling the request
    .use('/sse/*', stytchBearerTokenAuthMiddleware)
    .route('/sse', new Hono().mount('/', WeatherAppMCP.serveSSE('/sse').fetch))
    .use('/mcp/*', stytchBearerTokenAuthMiddleware)
    .route('/mcp', new Hono().mount('/', WeatherAppMCP.serve('/mcp').fetch))

    // Finally - serve static assets from Vite
    .mount('/', (req, env) => env.ASSETS.fetch(req))