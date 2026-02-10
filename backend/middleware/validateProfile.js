const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[0-9+()\s-]{4,30}$/;

module.exports = function validateProfile(req, res, next) {
  const { name, email, phone, country } = req.body;
  const errors = [];

  if (typeof name !== 'undefined') {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      errors.push('Name must be a string between 2 and 100 characters');
    }
  }

  if (typeof email !== 'undefined') {
    if (typeof email !== 'string' || !emailRegex.test(email) || email.length > 254) {
      errors.push('Invalid email address');
    }
  }

  if (typeof phone !== 'undefined' && phone !== null && phone !== '') {
    if (typeof phone !== 'string' || !phoneRegex.test(phone)) {
      errors.push('Invalid phone number');
    }
  }

  if (typeof country !== 'undefined') {
    if (typeof country !== 'string' || country.trim().length === 0 || country.trim().length > 100) {
      errors.push('Invalid country');
    }
  }

  if (errors.length > 0) return res.status(400).json({ success: false, errors });
  return next();
};
