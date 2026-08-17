const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DB_url;

if (!dbUrl) {
  console.error("Database connection URL (DB_url) is missing in environment variables!");
  process.exit(1);
}

let poolConfig = {};

const useSSL = process.env.DB_SSL !== undefined
  ? process.env.DB_SSL === 'true'
  : !(dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1'));

try {
  // Custom parser to split on the last '@' to handle passwords containing '@'
  if (dbUrl.includes('@')) {
    const withoutPrefix = dbUrl.replace(/^postgresql:\/\/|^postgres:\/\//, "");
    const lastAtIndex = withoutPrefix.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const userPass = withoutPrefix.substring(0, lastAtIndex);
      const hostDb = withoutPrefix.substring(lastAtIndex + 1);

      const colonIndex = userPass.indexOf(":");
      const user = colonIndex !== -1 ? userPass.substring(0, colonIndex) : userPass;
      const password = colonIndex !== -1 ? userPass.substring(colonIndex + 1) : "";

      const slashIndex = hostDb.indexOf("/");
      const hostPort = slashIndex !== -1 ? hostDb.substring(0, slashIndex) : hostDb;
      const database = slashIndex !== -1 ? hostDb.substring(slashIndex + 1) : "";

      const hostPortColonIndex = hostPort.indexOf(":");
      const host = hostPortColonIndex !== -1 ? hostPort.substring(0, hostPortColonIndex) : hostPort;
      const port = hostPortColonIndex !== -1 ? parseInt(hostPort.substring(hostPortColonIndex + 1), 10) : 5432;

      poolConfig = {
        user,
        password,
        host,
        port,
        database,
        ssl: useSSL ? { rejectUnauthorized: false } : false
      };
    } else {
      poolConfig = {
        connectionString: dbUrl,
        ssl: useSSL ? { rejectUnauthorized: false } : false
      };
    }
  } else {
    poolConfig = {
      connectionString: dbUrl,
      ssl: useSSL ? { rejectUnauthorized: false } : false
    };
  }
} catch (error) {
  console.error("Error parsing DB_url, falling back to connectionString direct pass:", error.message);
  poolConfig = {
    connectionString: dbUrl,
    ssl: useSSL ? { rejectUnauthorized: false } : false
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

  const createInvoiceItemsTableQuery = `
    CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INT REFERENCES invoices(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL,
      unit_price NUMERIC(10, 2) NOT NULL,
      total_price NUMERIC(10, 2) NOT NULL
    );
  `;

  try {
    const client = await pool.connect();
    console.log("Successfully connected to the PostgreSQL database.");
    await client.query(createUsersTableQuery);
    console.log("Users table verified/created successfully.");
    await client.query(createInvoicesTableQuery);
    console.log("Invoices table verified/created successfully.");
    
    // Add share_token column if it doesn't exist
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token VARCHAR(100) UNIQUE;
    `);
    console.log("Verified share_token column in invoices table.");
    
    // Backfill any empty share_tokens for existing invoices
    await client.query(`
      UPDATE invoices SET share_token = md5(random()::text || clock_timestamp()::text) 
      WHERE share_token IS NULL;
    `);
    console.log("Backfilled share_token for existing invoices.");

    await client.query(createInvoiceItemsTableQuery);
    console.log("Invoice items table verified/created successfully.");
    client.release();
  } catch (err) {
    console.error("Database initialization failed:", err.message);
    throw err;
  }
};

module.exports = {
  pool,
  initDB
};
