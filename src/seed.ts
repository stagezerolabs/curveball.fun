import { db, closeDatabase } from "./db";
import { tokens } from "./db/schema";

try {
  await db
    .insert(tokens)
    .values({
      address: "0x000000000000000000000000000000000000c0de",
      name: "Curveball",
      symbol: "CURVE",
      creator: "local",
    })
    .onConflictDoNothing({ target: tokens.address });
  console.log("seeded");
} finally {
  await closeDatabase();
}
