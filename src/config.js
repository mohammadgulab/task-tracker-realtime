// Loads settings from the environment (and .env when present).
require('dotenv').config({ quiet: true });

const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || './data/app.db',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  activityLimit: Number(process.env.ACTIVITY_LIMIT) || 30,
};

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = config;
