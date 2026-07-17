const express = require('express');
const router = express.Router();
const {
  getCashbookSummary,
  getCashbookLedger,
  createCashbookEntry,
  addInvestment,
  deleteCashbookEntry,
  hardDeleteCashbookEntry
} = require('../controllers/cashbookController');
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

// Delete routes
router.delete('/entry/:id', deleteCashbookEntry);
router.delete('/entry/:id/permanent', hardDeleteCashbookEntry);

module.exports = router;