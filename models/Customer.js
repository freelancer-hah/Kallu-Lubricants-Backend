const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  shop_name: {
    type: String,
    default: null,
    trim: true
  },
  address: {
    type: String,
    default: null,
    trim: true
  },
  // Accounting fields
  openingBalance: {
    type: Number,
    default: 0
  },
  totalPurchases: {
    type: Number,
    default: 0
  },
  totalPayments: {
    type: Number,
    default: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  // Transfer info (only for Type 2 customers)
  transferredFrom: {
    type: String,
    default: null
  },
  transferAmount: {
    type: Number,
    default: 0
  },
  transferDate: {
    type: Date,
    default: null
  },
  // Customer type
  customerType: {
    type: String,
    enum: ['normal', 'transfer'],
    default: 'normal'
  },
  creditLimit: {
    type: Number,
    default: 0
  },
  gstNumber: {
    type: String
  }
}, { timestamps: true });

customerSchema.index({ name: 'text', phone: 'text', shop_name: 'text' });

module.exports = mongoose.model('Customer', customerSchema);