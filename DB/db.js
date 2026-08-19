const { Pool } = require("pg");
require("dotenv").config();

const dbUrl = process.env.DB_url;

if (!dbUrl) {
  console.error(
    "Database connection URL (DB_url) is missing in environment variables!",
  );
  process.exit(1);
}

let poolConfig = {};

const useSSL =
  process.env.DB_SSL !== undefined
    ? process.env.DB_SSL === "true"
    : !(dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1"));

try {
  // Custom parser to split on the last '@' to handle passwords containing '@'
  if (dbUrl.includes("@")) {
    const withoutPrefix = dbUrl.replace(/^postgresql:\/\/|^postgres:\/\//, "");
    const lastAtIndex = withoutPrefix.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const userPass = withoutPrefix.substring(0, lastAtIndex);
      const hostDb = withoutPrefix.substring(lastAtIndex + 1);

      const colonIndex = userPass.indexOf(":");
      const user =
        colonIndex !== -1 ? userPass.substring(0, colonIndex) : userPass;
      const password =
        colonIndex !== -1 ? userPass.substring(colonIndex + 1) : "";

      const slashIndex = hostDb.indexOf("/");
      const hostPort =
        slashIndex !== -1 ? hostDb.substring(0, slashIndex) : hostDb;
      const database =
        slashIndex !== -1 ? hostDb.substring(slashIndex + 1) : "";

      const hostPortColonIndex = hostPort.indexOf(":");
      const host =
        hostPortColonIndex !== -1
          ? hostPort.substring(0, hostPortColonIndex)
          : hostPort;
      const port =
        hostPortColonIndex !== -1
          ? parseInt(hostPort.substring(hostPortColonIndex + 1), 10)
          : 5432;

      poolConfig = {
        user,
        password,
        host,
        port,
        database,
        ssl: useSSL ? { rejectUnauthorized: false } : false,
      };
    } else {
      poolConfig = {
        connectionString: dbUrl,
        ssl: useSSL ? { rejectUnauthorized: false } : false,
      };
    }
  } else {
    poolConfig = {
      connectionString: dbUrl,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    };
  }
} catch (error) {
  console.error(
    "Error parsing DB_url, falling back to connectionString direct pass:",
    error.message,
  );
  poolConfig = {
    connectionString: dbUrl,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(poolConfig);

const initDB = async () => {
  const createUsersTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createCustomersTableQuery = `
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone_number VARCHAR(55) NOT NULL,
      email VARCHAR(255),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      postal_code VARCHAR(50),
      gender VARCHAR(20),
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (phone_number, user_id)
    );
  `;

  const createInvoicesTableQuery = `
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      invoice_number VARCHAR(100) UNIQUE NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(55) NOT NULL,
      invoice_date DATE NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      total_amount NUMERIC(10, 2) NOT NULL,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createOrdersTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(100) UNIQUE NOT NULL,
      customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
      service_type VARCHAR(50),
      measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
      special_instructions TEXT,
      inspiration_link TEXT,
      cloth_images TEXT,
      delivery_date DATE NOT NULL,
      trial_date DATE,
      quantity INT NOT NULL DEFAULT 1,
      stitching_price NUMERIC(10, 2),
      price_breakup TEXT,
      status VARCHAR(50) DEFAULT 'Pending',
      invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      items JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `;

  const createInvoiceItemsTableQuery = `
    CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INT REFERENCES invoices(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL,
      unit_price NUMERIC(10, 2) NOT NULL,
      total_price NUMERIC(10, 2) NOT NULL,
      measurements JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `;

  try {
    const client = await pool.connect();
    console.log("Successfully connected to the PostgreSQL database.");
    await client.query(createUsersTableQuery);
    console.log("Users table verified/created successfully.");
    await client.query(createCustomersTableQuery);
    console.log("Customers table verified/created successfully.");
    await client.query(createInvoicesTableQuery);
    console.log("Invoices table verified/created successfully.");

    // Add share_token column if it doesn't exist
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token VARCHAR(100) UNIQUE;
    `);
    console.log("Verified share_token column in invoices table.");

    // Add optional customer_id to invoices if it doesn't exist
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
    `);
    console.log("Verified customer_id column in invoices table.");

    // Backfill any empty share_tokens for existing invoices
    await client.query(`
      UPDATE invoices SET share_token = md5(random()::text || clock_timestamp()::text) 
      WHERE share_token IS NULL;
    `);
    console.log("Backfilled share_token for existing invoices.");

    await client.query(createOrdersTableQuery);
    console.log("Orders table verified/created successfully.");

    // Run schema alterations for existing orders table if needed
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE orders ALTER COLUMN service_type DROP NOT NULL;
      ALTER TABLE orders ALTER COLUMN stitching_price DROP NOT NULL;
    `);
    console.log(
      "Verified items column and dropped constraints in orders table.",
    );

    // Add payment tracking columns to orders if they don't exist
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(10, 2) NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0;
    `);
    console.log(
      "Verified advance_paid and balance_due columns in orders table.",
    );

    // Backfill balance_due for existing orders where it is still 0
    await client.query(`
      UPDATE orders
      SET balance_due = GREATEST((COALESCE(stitching_price, 0) * COALESCE(quantity, 1)) - COALESCE(advance_paid, 0), 0)
      WHERE balance_due = 0 AND stitching_price IS NOT NULL AND stitching_price > 0;
    `);
    console.log("Backfilled balance_due for existing orders.");

    // Add payment tracking columns to invoices if they don't exist
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(10, 2) NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0;
    `);
    console.log(
      "Verified advance_paid and balance_due columns in invoices table.",
    );

    await client.query(createInvoiceItemsTableQuery);
    console.log("Invoice items table verified/created successfully.");

    await client.query(`
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS measurements JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    console.log("Verified measurements column in invoice_items table.");

    client.release();
  } catch (err) {
    console.error("Database initialization failed:", err.message);
    throw err;
  }
};

module.exports = {
  pool,
  initDB,
};
