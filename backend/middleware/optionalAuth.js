const { verifyToken } = require('../services/tokenService');

module.exports = (req, res, next) => {
  try {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      const payload = verifyToken(token);
      if (payload) req.user = payload;
    }
  } catch (e) { /* ignore */ }
  next();
};
