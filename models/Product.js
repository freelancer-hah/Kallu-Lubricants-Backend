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
  costPrice: {
    type: Number,
    required: true,
    min: 0
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  unit: {
    type: String,
    default: 'piece'
  }
}, {
  timestamps: true
});

// Update selling price method
productSchema.methods.updateSellingPrice = function(newPrice) {
  this.sellingPrice = newPrice;
  return this.save();
};

module.exports = mongoose.model('Product', productSchema);