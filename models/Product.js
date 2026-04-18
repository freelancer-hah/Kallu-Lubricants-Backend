const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  currentCostPrice: {
    type: Number,
    default: 0
  },
  currentSellingPrice: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    default: 0
  },
  // Price history for tracking
  priceHistory: [{
    costPrice: Number,
    sellingPrice: Number,
    date: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Product', productSchema);