const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  type: { type: String },
  action: { type: String },
  amount: { type: Number, default: 0 },
  btcAmount: { type: Number, default: 0 },
  currency: { type: String },
  status: { type: String },
  timestamp: { type: Date, default: Date.now },
  userId: { type: String },
  userName: { type: String },
  userEmail: { type: String },
  description: { type: String },
  collateralBTC: { type: Number, default: 0 },
  loanAmount: { type: Number, default: 0 },
  repaymentPeriod: { type: Number, default: 0 },
  repaymentDate: { type: Date },
  dueDate: { type: Date },
  interestRate: { type: Number, default: 0 },
  withdrawalAddress: { type: String },
  relatedLoanId: { type: String },
  network: { type: String },
  transactionId: { type: String },
  appliedToBalances: { type: Boolean, default: false }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
