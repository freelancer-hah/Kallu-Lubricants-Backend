const express = require('express');
const router = express.Router();
const { 
  getCustomerLedger, 
  addOpeningBalance,
  recordCustomerPayment 
} = require('../controllers/customerLedgerController');
const { auth } = require('../middleware/auth');

router.use(auth);
router.get('/', getCustomerLedger);
router.post('/opening-balance', addOpeningBalance);
router.post('/payment', recordCustomerPayment);

module.exports = router;