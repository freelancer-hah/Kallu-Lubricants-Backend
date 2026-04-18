const mongoose = require('mongoose');

const cashbookSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['sale', 'purchase', 'expense', 'payment_received', 'payment_made', 'bank_transfer', 'opening_balance', 'investment'],
    required: true
  },
  referenceId: {
    type: String,
    default: null
  },
  partyName: {
    type: String,
    required: true
  },
  partyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  description: {
    type: String,
    required: true
  },
  debit: {
    type: Number,
    default: 0
  },
  credit: {
    type: Number,
    default: 0
  },
  balance: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank', 'upi', 'cheque'],
    default: 'cash'
  },
  bankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

cashbookSchema.index({ date: -1, partyName: 1 });
cashbookSchema.index({ type: 1, referenceId: 1 });
cashbookSchema.index({ bankAccountId: 1 });

module.exports = mongoose.model('Cashbook', cashbookSchema);