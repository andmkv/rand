console.error(
  [
    "Drizzle snapshot history ends at 0005, while reviewed SQL migrations continue through 0010.",
    "Do not generate a migration from that stale snapshot: Drizzle cannot infer the intended history of removed legacy tables and current declarations.",
    "Follow the manual forward-SQL workflow in docs/DEVELOPMENT.md, then run npm run db:verify-schema and npm run api:test.",
  ].join("\n"),
);
process.exitCode = 1;
