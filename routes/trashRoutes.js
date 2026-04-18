const express = require('express');
const router = express.Router();
const { getTrashItems, restoreFromTrash, permanentDelete } = require('../controllers/trashBinController');
const { auth } = require('../middleware/auth');

router.use(auth);
router.get('/', getTrashItems);
router.post('/restore/:id', restoreFromTrash);
router.delete('/permanent/:id', permanentDelete);

module.exports = router;