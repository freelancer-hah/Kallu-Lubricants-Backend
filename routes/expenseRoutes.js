const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const { auth } = require('../middleware/auth');
const { createCashbookEntry } = require('../controllers/cashbookController');

// Get all expenses
router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const expenses = await Expense.find(query).sort({ date: -1 });
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    // Group by category
    const byCategory = {};
    expenses.forEach(e => {
      if (!byCategory[e.category]) byCategory[e.category] = 0;
      byCategory[e.category] += e.amount;
    });
    
    res.json({ expenses, total, byCategory });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create expense
router.post('/', auth, async (req, res) => {
  try {
    const { description, category, amount, date, notes } = req.body;
    
    const expense = new Expense({
      description,
      category,
      amount,
      date: date || new Date(),
      notes
    });
    
    await expense.save();
    
    // Create cashbook entry (CREDIT - paisa gaya)
    await createCashbookEntry({
      date: date || new Date(),
      type: 'expense',
      referenceId: expense._id.toString(),
      partyName: description,
      description: `Expense: ${description} (${category})`,
      debit: 0,
      credit: amount,
      paymentMethod: 'cash',
      createdBy: req.user.id
    });
    
    res.status(201).json(expense);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete expense
router.delete('/:id', auth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    
    await expense.deleteOne();
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;