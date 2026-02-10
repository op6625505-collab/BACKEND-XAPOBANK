const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  phone: { type: String },
  country: { type: String },
  // Password reset token and expiry
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  // Identity verification fields
  passportPath: { type: String },
  nationalIdPath: { type: String },
  driversLicensePath: { type: String },
  livePhotoPath: { type: String },
  idVerified: { type: Boolean, default: false },
  idUploadedAt: { type: Date },
  // Persisted balances
  savingsBalanceUSD: { type: Number, default: 0 },
  collateralBalanceUSD: { type: Number, default: 0 },
  collateralBalanceBTC: { type: Number, default: 0 },
  btcBalance: { type: Number, default: 0 },
  isMember: { type: Boolean, default: false },
  membershipId: { type: String },
  membershipPaidAmount: { type: Number, default: 0 },
  membershipPaidAt: { type: Date },
  membershipExpiresAt: { type: Date },
  activeLoanId: { type: String },
  activeLoanAmount: { type: Number, default: 0 },
  activeLoanDueDate: { type: Date },
  // Promo / referral fields
  promoCode: { type: String },
  promoAppliedAt: { type: Date },
  promoBonusUSD: { type: Number, default: 0 },
  promoFirstDepositUsed: { type: Boolean, default: false },
  // Two-Factor Authentication
  twoFactorEnabled: { type: Boolean, default: false },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
