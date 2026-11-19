# Business management dashboard

A business dashboard for customers, products and inventory, sales, invoices, expenses, employees, and tasks. The frontend is React, the API is Node.js/Express, and MySQL stores application data.

## Requirements

- Node.js 20 or newer
- MySQL 8 or newer

## Local setup

1. Create a MySQL database, for example:

   ```sql
   CREATE DATABASE business_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Copy `.env.example` to `.env`, then set the MySQL connection values, a unique `JWT_SECRET` of at least 32 characters, and the initial administrator name, email, and password. The administrator password must be at least 12 characters.
3. Install packages and initialize the schema:

   ```sh
   npm install
   npm run db:setup
   npm run db:seed-admin
   ```

4. Start the frontend and API:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5173`. The Vite development server forwards `/api` requests to the API on port 4000.

## Included workflows

- Administrators can manage customer, product, inventory, sales, invoice, expense, employee, and task records.
- Employees can view operational records and update the status of their assigned tasks. Expenses and employee-account management are administrator-only.
- Recording a sale checks stock and reduces inventory in the same database transaction.
- The overview flags products with five or fewer units as low stock.
- Employee passwords are hashed before storage. Employee account access can be disabled from the Employees page.
- Invoices are basic records for tracking amount and status; payment processing and external integrations are not included.
- Amounts are stored as decimal values and displayed without a currency symbol; use the business's agreed currency when entering records.

## Verification

```sh
npm test
npm run build
```
