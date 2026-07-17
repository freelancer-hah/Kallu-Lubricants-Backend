const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
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
  // ✅ Add weighted average cost
  weightedAverageCost: {
    type: Number,
    default: 0
  },
  // ✅ Track total value of inventory
  totalInventoryValue: {
    type: Number,
    default: 0
  },
  priceHistory: [{
    costPrice: Number,
    sellingPrice: Number,
    quantity: Number,
    date: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// ✅ Method to update weighted average cost on purchase
productSchema.methods.updateWeightedAverage = function(newCostPrice, newQuantity) {
  // Calculate current total value
  const currentTotalValue = this.weightedAverageCost * this.quantity;
  const newTotalValue = newCostPrice * newQuantity;
  const totalQuantity = this.quantity + newQuantity;
  
  // Calculate new weighted average
  this.weightedAverageCost = (currentTotalValue + newTotalValue) / totalQuantity;
  this.totalInventoryValue = currentTotalValue + newTotalValue;
  this.quantity = totalQuantity;
  this.currentCostPrice = newCostPrice;
  
  return this;
};

// ✅ Method to reduce stock on sale (keeps weighted average cost)
productSchema.methods.reduceStock = function(soldQuantity) {
  if (soldQuantity > this.quantity) {
    throw new Error(`Insufficient stock. Available: ${this.quantity}`);
  }
  
  // Calculate cost of goods sold using weighted average
  const costOfGoodsSold = this.weightedAverageCost * soldQuantity;
  
  // Reduce quantity
  this.quantity -= soldQuantity;
  
  // Update total inventory value
  this.totalInventoryValue -= costOfGoodsSold;
  
  // If stock becomes 0, reset weighted average to 0
  if (this.quantity === 0) {
    this.weightedAverageCost = 0;
    this.totalInventoryValue = 0;
  }
  
  return costOfGoodsSold;
};

module.exports = mongoose.model('Product', productSchema);