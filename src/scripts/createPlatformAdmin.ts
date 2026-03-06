import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { businesses, branches, users } from "../db/schema/schema.js";
import { hashPassword } from "../lib/password.js";

async function main(): Promise<void> {
  const email =
    process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase() ??
    "stockflowke@gmail.com";
  const name = process.env.PLATFORM_ADMIN_NAME ?? "Platform Owner";
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "ChangeMe123!";

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `[platform-admin] User with email ${email} already exists with role ${existing.role}`,
    );
    return;
  }

  const [business] = await db
    .insert(businesses)
    .values({
      name: "Platform Admin Business",
      ownerName: name,
      ownerEmail: email,
    })
    .returning({ id: businesses.id });

  if (!business) {
    throw new Error("Failed to create platform admin business");
  }

  const [branch] = await db
    .insert(branches)
    .values({
      businessId: business.id,
      name: "Main",
    })
    .returning({ id: branches.id });

  if (!branch) {
    throw new Error("Failed to create platform admin branch");
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      businessId: business.id,
      branchId: branch.id,
      name,
      email,
      passwordHash,
      role: "platform_admin",
      emailVerified: true,
      isActive: 1,
    })
    .returning();

  if (!user) {
    throw new Error("Failed to create platform admin user");
  }

  // eslint-disable-next-line no-console
  console.log("[platform-admin] Created platform_admin user:");
  // eslint-disable-next-line no-console
  console.log(`  Email:    ${email}`);
  // eslint-disable-next-line no-console
  console.log(`  Password: ${password}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[platform-admin] Failed to create platform admin user:", err);
  process.exitCode = 1;
});

