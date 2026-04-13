const mongoose = require('mongoose');

const stockAdjustmentSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  systemQuantity: {
    type: Number,
    required: true
  },
  physicalQuantity: {
    type: Number,
    required: true
  },
  difference: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  adjustedBy: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);