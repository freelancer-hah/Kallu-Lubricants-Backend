const mongoose = require('mongoose');

const customerLedgerSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  transactionType: {
    type: String,
    enum: ['opening_balance', 'sale', 'payment_received', 'credit_note', 'debit_note'],
    required: true
  },
  referenceNo: {
    type: String,
    required: true
  },
  description: {
    type: String
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

customerLedgerSchema.index({ customerId: 1, date: -1 });
customerLedgerSchema.index({ referenceNo: 1 });

module.exports = mongoose.model('CustomerLedger', customerLedgerSchema);