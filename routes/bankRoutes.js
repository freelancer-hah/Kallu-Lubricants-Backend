const express = require('express');
const router = express.Router();
const { getBankAccounts, createBankAccount, transferFunds } = require('../controllers/bankAccountController');
const { auth } = require('../middleware/auth');

router.use(auth);
router.get('/', getBankAccounts);
router.post('/', createBankAccount);
router.post('/transfer', transferFunds);

module.exports = router;