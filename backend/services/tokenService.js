const jwt = require('jsonwebtoken');
const config = require('../config/config');

function signToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET || 'test-secret', { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET || 'test-secret');
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
