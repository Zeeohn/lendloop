import type { AuthConfig } from "convex/server";

// Clerk issues a JWT from its "convex" JWT template; Convex verifies it against
// the issuer below. Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard.
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
