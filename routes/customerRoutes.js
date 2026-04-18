const express = require('express');
const router = express.Router();
const {
  getCustomers,
  getCustomer,
  searchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerWithLedger,
  updateOpeningBalance
} = require('../controllers/customerController');

// Import auth middleware correctly - destructure the object
const { auth, adminOnly } = require('../middleware/auth');

// All customer routes require authentication
router.use(auth);

router.get('/', getCustomers);
router.get('/search', searchCustomers);
router.get('/:id', getCustomer);
router.get('/:id/ledger', getCustomerWithLedger);
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.put('/:id/opening-balance', updateOpeningBalance);

module.exports = router;