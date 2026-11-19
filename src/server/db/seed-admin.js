import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

try {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters.");
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [ADMIN_NAME, ADMIN_EMAIL.trim().toLowerCase(), passwordHash],
    );
    await connection.execute("INSERT INTO employees (user_id) VALUES (?)", [result.insertId]);
    await connection.commit();
    console.log("Administrator account created.");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
} catch (error) {
  console.error("Could not create the administrator account:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
