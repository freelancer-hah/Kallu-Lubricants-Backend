const express = require('express');
const router = express.Router();
const { 
  getCustomerLedger, 
  recordCustomerPayment 
} = require('../controllers/customerLedgerController');
const { auth } = require('../middleware/auth');

router.use(auth);
router.get('/', getCustomerLedger);
router.post('/payment', recordCustomerPayment);

module.exports = router;