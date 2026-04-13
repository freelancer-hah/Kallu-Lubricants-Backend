const express = require('express');
const router = express.Router();
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');

// Get all purchases
router.get('/', auth, async (req, res) => {
  try {
    const purchases = await Purchase.find().populate('product', 'name company').sort({ date: -1 });
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create purchase
router.post('/', auth, async (req, res) => {
  try {
    const { company, product, costPrice, quantity, date, notes } = req.body;
    
    // Find product
    const existingProduct = await Product.findById(product);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Calculate total
    const totalAmount = costPrice * quantity;
    
    // Create purchase record
    const purchase = new Purchase({
      company,
      product,
      productName: existingProduct.name,
      costPrice,
      quantity,
      totalAmount,
      date,
      notes
    });
    
    // Update product stock and cost price (weighted average)
    const newTotalQuantity = existingProduct.quantity + quantity;
    const newTotalCost = (existingProduct.costPrice * existingProduct.quantity) + (costPrice * quantity);
    const newAverageCost = newTotalCost / newTotalQuantity;
    
    existingProduct.quantity = newTotalQuantity;
    existingProduct.costPrice = newAverageCost;
    
    await existingProduct.save();
    await purchase.save();
    
    res.status(201).json(purchase);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete purchase
router.delete('/:id', auth, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase not found' });
    
    // Restore stock
    const product = await Product.findById(purchase.product);
    if (product) {
      product.quantity -= purchase.quantity;
      await product.save();
    }
    
    await purchase.deleteOne();
    res.json({ message: 'Purchase deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;