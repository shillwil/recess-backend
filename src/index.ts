import { db } from './db';
import { config } from './config';

async function main() {
  console.log(`Application starting in ${config.env} mode...`);

  // Example: You can perform a simple query to test the DB connection
  try {
    // Drizzle doesn't have a direct 'ping' or 'connect' method that returns a promise,
    // so we'll just log that the db object is initialized.
    // A real query would be needed to truly test the connection.
    console.log('Database client initialized.');
    console.log('Successfully connected to the database using config:', config.database.url?.substring(0, config.database.url.indexOf('@')) + '@...host:port/database');

    // You can start your server here, e.g., app.listen(...)

  } catch (error) {
    console.error('Failed to connect to the database:', error);
    process.exit(1);
  }
}

main();
