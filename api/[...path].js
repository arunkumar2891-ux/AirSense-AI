import { app } from "../server/index.js";

// Vercel invokes this catch-all for /api/*. Express keeps its existing /api routes.
export default app;
