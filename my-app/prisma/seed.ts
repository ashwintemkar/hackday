import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  // Hashing a default password for the user
  const hashedPassword = await bcrypt.hash("defaultPassword123", 10);

  // Check if the user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: "johndoe@example.com" },
  });

  if (existingUser) {
    console.log("User already exists:", existingUser);
  } else {
    // Create a new user
    const user = await prisma.user.create({
      data: {
        name: "John Doe",
        email: "johndoe@example.com",
      },
    });

    console.log("User created:", user);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
