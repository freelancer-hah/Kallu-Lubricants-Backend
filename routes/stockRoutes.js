const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const StockAdjustment = require('../models/StockAdjustment');
const { auth } = require('../middleware/auth');

// Get stock status
router.get('/status', auth, async (req, res) => {
  try {
    const products = await Product.find().sort({ name: 1 });
    
    const summary = {
      totalProducts: products.length,
      totalValue: products.reduce((sum, p) => sum + (p.costPrice * p.quantity), 0),
      lowStockProducts: products.filter(p => p.quantity < 10).length,
      outOfStock: products.filter(p => p.quantity === 0).length
    };
    
    res.json({ products, summary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get stock adjustments
router.get('/adjustments', auth, async (req, res) => {
  try {
    const adjustments = await StockAdjustment.find().sort({ date: -1 });
    res.json(adjustments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create stock adjustment (reconciliation)
router.post('/adjust', auth, async (req, res) => {
  try {
    const { productId, physicalQuantity, reason } = req.body;
    
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    const systemQuantity = product.quantity;
    const difference = physicalQuantity - systemQuantity;
    
    // Create adjustment record
    const adjustment = new StockAdjustment({
      product: product._id,
      productName: product.name,
      systemQuantity,
      physicalQuantity,
      difference,
      reason,
      adjustedBy: req.user?.username || 'system'
    });
    
    // Update product quantity
    product.quantity = physicalQuantity;
    await product.save();
    await adjustment.save();
    
    res.json({ product, adjustment });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;