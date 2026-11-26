import dotenv from "dotenv";

// Imported before any module that reads process.env. ESM evaluates this
// dependency first when server/index.js imports it ahead of the others.
dotenv.config();
