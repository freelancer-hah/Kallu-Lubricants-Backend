const express = require('express');
const router = express.Router();
const { getCashbookSummary, getCashbookLedger, createCashbookEntry, addInvestment } = require('../controllers/cashbookController');
const { auth } = require('../middleware/auth');

router.use(auth);

// Get routes
router.get('/summary', getCashbookSummary);
router.get('/ledger', getCashbookLedger);

// Post routes
router.post('/investment', addInvestment);
router.post('/entry', async (req, res) => {
  try {
    const entry = await createCashbookEntry({
      ...req.body,
      createdBy: req.user.id
    });
    res.json(entry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;