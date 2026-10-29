const jwt = require('jsonwebtoken');
const config = require('./config');
const { HttpError } = require('./errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Returns the user id from a token, or null if the token is bad or expired.
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return Number(payload.sub) || null;
  } catch {
    return null;
  }
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, created_at: row.created_at };
}

// Express middleware: needs "Authorization: Bearer <token>".
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Missing or malformed Authorization header'));
  }
  const userId = verifyToken(token);
  if (!userId) return next(new HttpError(401, 'Invalid or expired token'));

  const user = req.app.locals.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return next(new HttpError(401, 'User no longer exists'));

  req.user = publicUser(user);
  next();
}

module.exports = { signToken, verifyToken, requireAuth, publicUser };
