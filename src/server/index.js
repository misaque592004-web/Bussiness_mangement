import "dotenv/config";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "./db/pool.js";
import { isDate, isPositiveNumber, parseId, parseResourceFields } from "./validation.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "100kb" }));

async function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  let identity;
  try {
    identity = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Your session has expired. Sign in again." });
  }

  try {
    const [users] = await pool.execute(
      "SELECT id, name, email, role FROM users WHERE id = ? AND active = TRUE",
      [identity.id],
    );
    if (!users.length) return res.status(401).json({ error: "Your account is unavailable. Sign in again." });
    req.user = users[0];
    return next();
  } catch (error) {
    return sendDatabaseError(error, res);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Administrator access is required." });
  }
  return next();
}

function sendDatabaseError(error, res) {
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ error: "That value already exists." });
  }
  if (error.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({ error: "A selected customer, product, or employee does not exist." });
  }
  if (error.code === "ER_ROW_IS_REFERENCED_2") {
    return res.status(409).json({ error: "This record is linked to other business records and cannot be deleted." });
  }
  console.error(error);
  return res.status(500).json({ error: "The request could not be completed." });
}

function validateFields(resource, values) {
  const stringLimits = {
    name: 160,
    email: 190,
    phone: 40,
    company: 160,
    sku: 80,
    category: 120,
    description: resource === "tasks" ? 2000 : 240,
    invoice_number: 60,
    title: 180,
  };
  for (const [field, value] of Object.entries(values)) {
    if (stringLimits[field] && (typeof value !== "string" || value.length > stringLimits[field])) {
      return `${field} must be a string of at most ${stringLimits[field]} characters.`;
    }
  }
  for (const field of ["name", "sku", "description", "invoice_number", "title"]) {
    if (field in values && typeof values[field] === "string" && !values[field].trim()) {
      return `${field} cannot be empty.`;
    }
  }

  if (resource === "products" && "quantity" in values) {
    const quantity = Number(values.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return "quantity must be a whole number of zero or more.";
  }
  if (resource === "tasks" && "assigned_to" in values && !parseId(values.assigned_to)) {
    return "assigned_to must be a valid employee ID.";
  }
  if (resource === "customers" && "email" in values && values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return "email must be valid.";
  }
  for (const field of ["amount", "unit_price"]) {
    if (field in values && (!Number.isFinite(Number(values[field])) || Number(values[field]) < 0)) {
      return `${field} must be a non-negative number.`;
    }
  }
  if (["expenses", "invoices"].includes(resource) && "amount" in values && !isPositiveNumber(values.amount)) {
    return "amount must be greater than zero.";
  }
  if (resource === "invoices" && "customer_id" in values && !parseId(values.customer_id)) {
    return "customer_id must be a valid customer ID.";
  }
  if (resource === "invoices" && "status" in values && !["draft", "sent", "paid", "overdue"].includes(values.status)) {
    return "status must be draft, sent, paid, or overdue.";
  }
  if (resource === "tasks" && "status" in values && !["todo", "in_progress", "done"].includes(values.status)) {
    return "status must be todo, in_progress, or done.";
  }
  for (const field of ["issued_at", "due_date", "incurred_on"]) {
    if (field in values && values[field] !== null && !isDate(values[field])) {
      return `${field} must use YYYY-MM-DD format.`;
    }
  }
  if (resource === "tasks" && "due_date" in values && values.due_date !== null && !isDate(values.due_date)) {
    return "due_date must use YYYY-MM-DD format.";
  }
  return null;
}

app.post("/api/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const [users] = await pool.execute(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = ? AND active = TRUE",
      [email],
    );
    const user = users[0];
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password_hash || "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
    );
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const [sales] = await pool.query("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales");
    const [inventory] = await pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS units FROM products");
    const [lowStock] = await pool.query("SELECT COUNT(*) AS count FROM products WHERE quantity <= 5");
    const [customers] = await pool.query("SELECT COUNT(*) AS count FROM customers");
    const [invoices] = await pool.query(
      "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM invoices WHERE status IN ('sent', 'overdue')",
    );
    const [tasks] = req.user.role === "admin"
      ? await pool.query("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'")
      : await pool.execute("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done' AND assigned_to = ?", [req.user.id]);
    const [expenses] = req.user.role === "admin"
      ? await pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM expenses")
      : [[{ total: null }]];

    return res.json({
      salesTotal: sales[0].total,
      productCount: inventory[0].count,
      inventoryUnits: inventory[0].units,
      lowStockCount: lowStock[0].count,
      customerCount: customers[0].count,
      outstandingInvoiceCount: invoices[0].count,
      outstandingInvoiceTotal: invoices[0].total,
      openTaskCount: tasks[0].count,
      expenseTotal: expenses[0].total,
    });
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

const resources = {
  customers: {
    table: "customers",
    fields: ["name", "email", "phone", "company"],
    required: ["name"],
  },
  products: {
    table: "products",
    fields: ["name", "sku", "category", "quantity", "unit_price"],
    required: ["name", "sku", "quantity", "unit_price"],
  },
  invoices: {
    table: "invoices",
    fields: ["invoice_number", "customer_id", "amount", "status", "issued_at", "due_date"],
    required: ["invoice_number", "customer_id", "amount", "issued_at"],
  },
  expenses: {
    table: "expenses",
    fields: ["description", "amount", "category", "incurred_on"],
    required: ["description", "amount", "incurred_on"],
  },
  tasks: {
    table: "tasks",
    fields: ["title", "description", "status", "due_date", "assigned_to"],
    required: ["title", "description", "assigned_to"],
  },
};

app.get("/api/sales", authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.sale_number, s.quantity, s.unit_price, s.total_amount, s.sold_at,
              c.name AS customer_name, p.name AS product_name, u.name AS created_by_name
       FROM sales s
       JOIN customers c ON c.id = s.customer_id
       JOIN products p ON p.id = s.product_id
       JOIN users u ON u.id = s.created_by
       ORDER BY s.sold_at DESC, s.id DESC`,
    );
    return res.json(rows);
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.post("/api/sales", authenticate, requireAdmin, async (req, res) => {
  const fields = parseResourceFields(req.body, ["customer_id", "product_id", "quantity", "sold_at"], [
    "customer_id", "product_id", "quantity",
  ]);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const customerId = parseId(fields.values.customer_id);
  const productId = parseId(fields.values.product_id);
  const quantity = Number(fields.values.quantity);
  const soldAt = fields.values.sold_at || new Date().toISOString().slice(0, 10);
  if (!customerId || !productId || !Number.isSafeInteger(quantity) || quantity < 1 || !isDate(soldAt)) {
    return res.status(400).json({ error: "Choose valid customer and product IDs, a positive whole quantity, and a valid sale date." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [products] = await connection.execute(
      "SELECT quantity, unit_price FROM products WHERE id = ? FOR UPDATE",
      [productId],
    );
    const [customers] = await connection.execute("SELECT id FROM customers WHERE id = ?", [customerId]);
    if (!products.length || !customers.length) {
      await connection.rollback();
      return res.status(400).json({ error: "Choose an existing customer and product." });
    }
    if (products[0].quantity < quantity) {
      await connection.rollback();
      return res.status(409).json({ error: "There is not enough stock to complete this sale." });
    }

    const unitPrice = Number(products[0].unit_price);
    const total = Number((unitPrice * quantity).toFixed(2));
    const saleNumber = `S-${randomUUID().toUpperCase()}`;
    const [result] = await connection.execute(
      `INSERT INTO sales (sale_number, customer_id, product_id, quantity, unit_price, total_amount, sold_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [saleNumber, customerId, productId, quantity, unitPrice, total, soldAt, req.user.id],
    );
    await connection.execute("UPDATE products SET quantity = quantity - ? WHERE id = ?", [quantity, productId]);
    await connection.commit();
    return res.status(201).json({ id: result.insertId, sale_number: saleNumber });
  } catch (error) {
    await connection.rollback();
    return sendDatabaseError(error, res);
  } finally {
    connection.release();
  }
});

app.get("/api/employees", authenticate, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.active, e.title, e.phone, e.hire_date
       FROM users u LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role = 'employee' ORDER BY u.name`,
    );
    return res.json(rows);
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.post("/api/employees", authenticate, requireAdmin, async (req, res) => {
  const { name, email, password, title = "", phone = "", hire_date = null } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.length > 120 ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" || password.length < 12 ||
      typeof title !== "string" || title.length > 120 ||
      typeof phone !== "string" || phone.length > 40 ||
      (hire_date !== null && !isDate(hire_date))) {
    return res.status(400).json({ error: "Provide a name, valid email, password of at least 12 characters, and valid employee details." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(password, 12);
    const [userResult] = await connection.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'employee')",
      [name.trim(), email.trim().toLowerCase(), passwordHash],
    );
    await connection.execute(
      "INSERT INTO employees (user_id, title, phone, hire_date) VALUES (?, ?, ?, ?)",
      [userResult.insertId, title, phone, hire_date],
    );
    await connection.commit();
    return res.status(201).json({ id: userResult.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: "employee" });
  } catch (error) {
    await connection.rollback();
    return sendDatabaseError(error, res);
  } finally {
    connection.release();
  }
});

app.put("/api/employees/:id", authenticate, requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Employee ID is invalid." });
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const userValues = Object.fromEntries(["name", "email"].filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
  const employeeValues = Object.fromEntries(["title", "phone", "hire_date"].filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
  if (Object.hasOwn(body, "active")) {
    if (body.active !== true && body.active !== false && body.active !== "true" && body.active !== "false") {
      return res.status(400).json({ error: "active must be true or false." });
    }
    userValues.active = body.active === true || body.active === "true";
  }
  if (!Object.keys(userValues).length && !Object.keys(employeeValues).length) {
    return res.status(400).json({ error: "Provide at least one supported field." });
  }
  if ("name" in userValues && (typeof userValues.name !== "string" || !userValues.name.trim() || userValues.name.length > 120)) {
    return res.status(400).json({ error: "name must be a non-empty string of at most 120 characters." });
  }
  if ("email" in userValues && (typeof userValues.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userValues.email))) {
    return res.status(400).json({ error: "email must be valid." });
  }
  if ("title" in employeeValues && (typeof employeeValues.title !== "string" || employeeValues.title.length > 120)) {
    return res.status(400).json({ error: "title must be at most 120 characters." });
  }
  if ("phone" in employeeValues && (typeof employeeValues.phone !== "string" || employeeValues.phone.length > 40)) {
    return res.status(400).json({ error: "phone must be at most 40 characters." });
  }
  if ("hire_date" in employeeValues && employeeValues.hire_date !== null && !isDate(employeeValues.hire_date)) {
    return res.status(400).json({ error: "hire_date must use YYYY-MM-DD format." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'employee' FOR UPDATE",
      [id],
    );
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Employee not found." });
    }
    if (Object.keys(userValues).length) {
      const entries = Object.entries(userValues).map(([field, value]) => [
        field,
        field === "email" ? value.trim().toLowerCase() : field === "name" ? value.trim() : value,
      ]);
      await connection.execute(
        `UPDATE users SET ${entries.map(([field]) => `${field} = ?`).join(", ")} WHERE id = ? AND role = 'employee'`,
        [...entries.map(([, value]) => value), id],
      );
    }
    if (Object.keys(employeeValues).length) {
      const entries = Object.entries(employeeValues);
      await connection.execute(
        `UPDATE employees SET ${entries.map(([field]) => `${field} = ?`).join(", ")} WHERE user_id = ?`,
        [...entries.map(([, value]) => value), id],
      );
    }
    await connection.commit();
    return res.json({ id });
  } catch (error) {
    await connection.rollback();
    return sendDatabaseError(error, res);
  } finally {
    connection.release();
  }
});

app.get("/api/:resource", authenticate, async (req, res, next) => {
  const definition = resources[req.params.resource];
  if (!definition) return next();
  if (req.params.resource === "expenses" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Administrator access is required." });
  }

  try {
    const isTasks = req.params.resource === "tasks";
    const query = isTasks
      ? `SELECT t.*, u.name AS assigned_to_name FROM tasks t JOIN users u ON u.id = t.assigned_to
         ${req.user.role === "admin" ? "" : "WHERE t.assigned_to = ?"} ORDER BY t.created_at DESC`
      : `SELECT * FROM ${definition.table} ORDER BY id DESC`;
    const finalQuery = req.params.resource === "invoices"
      ? `SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.id DESC`
      : query;
    const [rows] = req.user.role !== "admin" && isTasks
      ? await pool.execute(finalQuery, [req.user.id])
      : await pool.query(finalQuery);
    return res.json(rows);
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.post("/api/:resource", authenticate, requireAdmin, async (req, res, next) => {
  const definition = resources[req.params.resource];
  if (!definition) return next();
  const fields = parseResourceFields(req.body, definition.fields, definition.required);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const validationError = validateFields(req.params.resource, fields.values);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const entries = Object.entries(fields.values);
    const [result] = await pool.execute(
      `INSERT INTO ${definition.table} (${entries.map(([field]) => field).join(", ")})
       VALUES (${entries.map(() => "?").join(", ")})`,
      entries.map(([, value]) => value),
    );
    return res.status(201).json({ id: result.insertId });
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.put("/api/:resource/:id", authenticate, async (req, res, next) => {
  if (req.params.resource === "employees" || req.params.resource === "sales") return next();
  const definition = resources[req.params.resource];
  if (!definition) return next();
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Record ID is invalid." });
  const isEmployeeTask = req.params.resource === "tasks" && req.user.role === "employee";
  if (req.user.role !== "admin" && !isEmployeeTask) {
    return res.status(403).json({ error: "Administrator access is required." });
  }

  const allowedFields = isEmployeeTask ? ["status"] : definition.fields;
  const fields = parseResourceFields(req.body, allowedFields);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const validationError = validateFields(req.params.resource, fields.values);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const ownership = isEmployeeTask ? " AND assigned_to = ?" : "";
    const lookupValues = isEmployeeTask ? [id, req.user.id] : [id];
    const [existing] = await pool.execute(
      `SELECT id FROM ${definition.table} WHERE id = ?${ownership}`,
      lookupValues,
    );
    if (!existing.length) return res.status(404).json({ error: "Record not found." });

    const entries = Object.entries(fields.values);
    const values = [...entries.map(([, value]) => value), id];
    if (isEmployeeTask) values.push(req.user.id);
    await pool.execute(
      `UPDATE ${definition.table} SET ${entries.map(([field]) => `${field} = ?`).join(", ")}
       WHERE id = ?${ownership}`,
      values,
    );
    return res.json({ id });
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.delete("/api/:resource/:id", authenticate, requireAdmin, async (req, res, next) => {
  if (req.params.resource === "employees" || req.params.resource === "sales") return next();
  const definition = resources[req.params.resource];
  if (!definition) return next();
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Record ID is invalid." });
  try {
    const [result] = await pool.execute(`DELETE FROM ${definition.table} WHERE id = ?`, [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Record not found." });
    return res.status(204).end();
  } catch (error) {
    return sendDatabaseError(error, res);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.path}.` });
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  console.error(error);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

const server = app.listen(port, () => {
  console.log(`Business management API listening on http://localhost:${port}`);
});

function shutDown() {
  server.close(() => {
    pool.end().then(() => process.exit(0)).catch((error) => {
      console.error("Could not close the database pool:", error.message);
      process.exit(1);
    });
  });
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
