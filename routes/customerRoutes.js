const express = require('express');
const router = express.Router();
const {
  getCustomers,
  getCustomer,
  getCustomerCompleteDetails,
  searchCustomers,
  addNormalCustomer,
  addTransferCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerWithLedger
} = require('../controllers/customerController');

const { auth } = require('../middleware/auth');

router.use(auth);

// GET routes
router.get('/', getCustomers);
router.get('/search', searchCustomers);
router.get('/:id', getCustomer);
router.get('/:id/complete', getCustomerCompleteDetails);
router.get('/:id/ledger', getCustomerWithLedger);

// POST routes - 2 types of customers
router.post('/normal', addNormalCustomer);      // TYPE 1: Normal customer (zero balance)
router.post('/transfer', addTransferCustomer);   // TYPE 2: Transfer customer (with balance)

// PUT/DELETE routes
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);

module.exports = router;