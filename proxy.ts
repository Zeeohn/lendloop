import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to pages. Access checks live where the data
// is: the dashboard page redirects signed-out visitors, and every Convex
// function re-checks identity and role on the server.
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
