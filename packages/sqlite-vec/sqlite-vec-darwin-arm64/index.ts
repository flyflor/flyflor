import { Database } from "bun:sqlite";

Database.setCustomSQLite("../sqlite-darwin-x64/libsqlite3.dylib");