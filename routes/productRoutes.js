const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');

// Get all products
router.get('/', auth, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single product
router.get('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ CREATE PRODUCT - WITH DUPLICATE CHECK
router.post('/', auth, async (req, res) => {
  try {
    const { name, company } = req.body;

    // Check if product already exists
    const existingProduct = await Product.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },  // Case insensitive check
      company: { $regex: new RegExp(`^${company}$`, 'i') }
    });

    if (existingProduct) {
      return res.status(400).json({
        message: `Product "${name}" already exists for company "${company}"`
      });
    }

    const product = new Product({
      name,
      company,
      currentCostPrice: 0,
      currentSellingPrice: 0,
      quantity: 0,
      priceHistory: []
    });

    await product.save();
    res.status(201).json(product);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Product already exists!' });
    }
    res.status(400).json({ message: error.message });
  }
});

// ✅ UPDATE PRODUCT - WITH DUPLICATE CHECK
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, company } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Check if another product with same name exists
    if (name && name !== product.name) {
      const existingProduct = await Product.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        company: { $regex: new RegExp(`^${company || product.company}$`, 'i') },
        _id: { $ne: req.params.id }
      });

      if (existingProduct) {
        return res.status(400).json({
          message: `Product "${name}" already exists for company "${company || product.company}"`
        });
      }
    }

    if (name) product.name = name;
    if (company) product.company = company;

    await product.save();
    res.json(product);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Product already exists!' });
    }
    res.status(400).json({ message: error.message });
  }
});

// Delete product
router.delete('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Check if product has stock
    if (product.quantity > 0) {
      return res.status(400).json({
        message: `Cannot delete "${product.name}" because it has ${product.quantity} units in stock. Please sell or adjust stock first.`
      });
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;