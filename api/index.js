/**
 * Serverless entry point.
 *
 * Vercel runs a function per request rather than a long-lived server, so it
 * imports the Express app and calls it directly. vercel.json sends every path
 * here; Express itself serves the static files and the API.
 */

import app from '../src/app.js';

export default app;
